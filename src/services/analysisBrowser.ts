import { spawn } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isRecord, targetUrl } from './webToolPolicy';

export class AnalysisBrowserError extends Error {}
export interface BrowserLease { endpoint: string; target: string; close(): Promise<void> }
interface OwnedProcess { alive(): boolean; stop(): Promise<void> }
export interface BrowserRuntime {
  findExecutable(): Promise<string | undefined>;
  createProfile(): Promise<string>;
  launch(executable: string, args: string[]): OwnedProcess;
  readPort(profile: string): Promise<string>;
  pages(endpoint: string, signal: AbortSignal): Promise<unknown>;
  removeProfile(profile: string): Promise<void>;
  pause(signal: AbortSignal): Promise<void>;
  now(): number;
}

export function browserCandidates(platform = process.platform, env = process.env): string[] {
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  if (platform === 'win32') return [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter((value): value is string => !!value).flatMap(base => [join(base, 'Google/Chrome/Application/chrome.exe'), join(base, 'Microsoft/Edge/Application/msedge.exe')]);
  if (platform === 'linux') return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/google/chrome/chrome'];
  return [];
}

export function browserArguments(profile: string, url: string): string[] {
  return ['--headless', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', targetUrl(url).href];
}

function launchOwned(executable: string, args: string[]): OwnedProcess {
  // No shell, inherited credentials, user browser profile or user-supplied flags.
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH','HOME','USERPROFILE','LOCALAPPDATA','SystemRoot','WINDIR','TMP','TEMP','TMPDIR','DISPLAY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','LANG','LC_ALL']) if (process.env[key]) env[key] = process.env[key];
  const child = spawn(executable, args, { shell: false, stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32', env });
  let exited = false;
  let resolveExit!: () => void;
  const exit = new Promise<void>(resolve => { resolveExit = resolve; });
  const finished = () => { exited = true; resolveExit(); };
  child.once('error', finished); child.once('exit', finished);
  let stopped: Promise<void> | undefined;
  return {
    alive: () => !exited,
    stop: () => stopped ??= (async () => {
      if (process.platform === 'win32' && child.pid && !exited) {
        // The PID belongs to this dedicated launch; never close arbitrary browsers.
        await new Promise<void>(resolve => {
          const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore', windowsHide: true });
          const timer = setTimeout(() => { killer.kill(); resolve(); }, 3000);
          const done = () => { clearTimeout(timer); resolve(); };
          killer.once('exit', done); killer.once('error', () => { child.kill(); done(); });
        });
      } else if (!exited && child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      }
      await Promise.race([exit, delay(2500)]);
      if (!exited && child.pid) {
        try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already closed. */ }
        await Promise.race([exit, delay(1000)]);
      }
      if (!exited) throw new AnalysisBrowserError('The analysis browser could not close. Close it before trying again.');
    })()
  };
}

const defaultRuntime: BrowserRuntime = {
  findExecutable: async () => {
    for (const candidate of browserCandidates()) {
      try { if (!(await stat(candidate)).isFile()) continue; await access(candidate, constants.X_OK); return candidate; } catch { /* Next installed browser. */ }
    }
  },
  createProfile: async () => {
    const profile = await mkdtemp(join(tmpdir(), 'rea-analysis-'));
    try {
      await chmod(profile, 0o700);
      await mkdir(join(profile, 'Default'));
      // Any browser-generated downloads remain in the owned temporary profile.
      await writeFile(join(profile, 'Default/Preferences'), JSON.stringify({ download: { default_directory: join(profile, 'downloads'), prompt_for_download: true } }), { mode: 0o600 });
      return profile;
    } catch (error) { await rm(profile, { recursive: true, force: true }); throw error; }
  },
  launch: launchOwned,
  readPort: profile => readFile(join(profile, 'DevToolsActivePort'), 'utf8'),
  pages: async (endpoint, signal) => {
    const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]), redirect: 'error' });
    if (!response.ok) throw new Error('Browser not ready.');
    const body = await response.text();
    if (body.length > 262144) throw new Error('Browser response exceeded the local limit.');
    return JSON.parse(body);
  },
  removeProfile: profile => rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
  pause: signal => delay(250, undefined, { signal }),
  now: () => Date.now()
};

export async function findBrowserExecutable(configured = ''): Promise<string | undefined> {
  if (configured && (!isAbsolute(configured) || /[\x00-\x1f\x7f]/.test(configured))) throw new AnalysisBrowserError('Browser path must be an absolute executable path.');
  for (const candidate of configured ? [configured] : browserCandidates()) {
    try { if (!(await stat(candidate)).isFile()) continue; await access(candidate, constants.X_OK); return candidate; } catch { /* Next installed browser. */ }
  }
  if (configured) throw new AnalysisBrowserError('Configured browser is not executable. Run REA: Set Up REA.');
}

export async function startAnalysisBrowser(options: { url: string; signal: AbortSignal; allowed: () => boolean; executablePath?: string }, runtime: BrowserRuntime = defaultRuntime): Promise<BrowserLease> {
  const requested = targetUrl(options.url).href;
  const guard = () => { if (options.signal.aborted || !options.allowed()) throw new AnalysisBrowserError('Analysis stopped. Trust this workspace and reconnect before trying again.'); };
  guard();
  const executable = options.executablePath ? await findBrowserExecutable(options.executablePath) : await runtime.findExecutable(); guard();
  if (!executable) throw new AnalysisBrowserError('Install Google Chrome or Chromium, then click Analyze again. REA uses a separate temporary browser profile.');
  const profile = await runtime.createProfile();
  let child: OwnedProcess | undefined;
  let cleanup: Promise<void> | undefined;
  const close = () => cleanup ??= (async () => {
    // Do not delete a profile while its browser may still be running.
    if (child) await child.stop();
    try { await runtime.removeProfile(profile); }
    catch { throw new AnalysisBrowserError('The browser closed, but its temporary files could not be removed. Restart VS Code before trying again.'); }
  })();
  try {
    guard();
    child = runtime.launch(executable, browserArguments(profile, requested));
    const deadline = runtime.now() + 20_000;
    let endpoint: string | undefined;
    let candidate = '', stableSince = runtime.now();
    while (runtime.now() < deadline) {
      guard();
      if (!child.alive()) throw new AnalysisBrowserError('The analysis browser could not start. Update Chrome or Chromium, then try again.');
      if (!endpoint) {
        try {
          const port = (await runtime.readPort(profile)).split(/\r?\n/)[0].trim();
          if (/^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) < 65536) endpoint = `http://127.0.0.1:${Number(port)}`;
        } catch { /* The owned browser has not published its port yet. */ }
      }
      if (endpoint) {
        try {
          const payload = await runtime.pages(endpoint, options.signal);
          const pages = Array.isArray(payload) ? payload.filter(item => isRecord(item) && item.type === 'page') : [];
          // Fresh profile + one startup URL: never choose among multiple tabs.
          if (pages.length === 1 && isRecord(pages[0])) {
            const url = targetUrl(String(pages[0].url ?? '')).href;
            if (url !== candidate) { candidate = url; stableSince = runtime.now(); }
            // Allow normal server redirects; record the final URL in the report.
            // A title is optional on a valid page. The fresh profile has one
            // startup tab, and a stable final URL is sufficient to identify it.
            if (candidate && runtime.now() - stableSince >= 1000) {
              guard();
              return { endpoint, target: url, close };
            }
          }
        } catch { /* Wait for navigation to commit; no target code is evaluated. */ }
      }
      await runtime.pause(options.signal);
    }
    throw new AnalysisBrowserError('The website did not open in the analysis browser. Check the URL and your internet connection, then try again.');
  } catch (error) {
    await close();
    if (error instanceof AnalysisBrowserError) throw error;
    throw new AnalysisBrowserError('The analysis browser could not start. Update Chrome or Chromium, then try again.');
  }
}
