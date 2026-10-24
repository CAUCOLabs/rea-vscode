import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DESKTOP_OBSERVER_JS } from '../native/desktopObserverSource';
import type { DesktopSelection } from './desktopDiscovery';
export interface DesktopObservationRequest {
  launch: { command: string; args: string[] }; selection: DesktopSelection; screenshot: boolean; signal: AbortSignal;
}
export type ObserveDesktopWindow = (request: DesktopObservationRequest) => Promise<unknown>;

function runObserver(command: string, args: string[], signal: AbortSignal, cwd: string): Promise<unknown> {
  signal.throwIfAborted();
  return new Promise((resolveValue, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const chunks: Buffer[] = []; let bytes = 0, stopped = false;
    let force: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (stopped) return; stopped = true;
      child.kill('SIGTERM');
      // Give the original REA runtime time to cancel and close its owned native helper.
      force = setTimeout(() => child.kill('SIGKILL'), 15000);
    };
    const deadline = setTimeout(stop, 165000);
    signal.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 48 * 1024 * 1024) stop(); else chunks.push(chunk); });
    child.stderr.on('data', () => { /* Drain private compiler/provider diagnostics; REA errors are returned as structured evidence. */ });
    const clean = () => { clearTimeout(deadline); if (force) clearTimeout(force); signal.removeEventListener('abort', stop); };
    child.on('error', () => { clean(); reject(new Error('The bundled Node runtime could not start the fixed REA native adapter.')); });
    child.on('close', code => {
      clean();
      if (stopped || signal.aborted) return reject(new Error('Desktop observation cancelled, timed out or exceeded its output budget.'));
      if (code !== 0) return reject(new Error('The original REA native adapter failed. Check the REA 6.7.0 installation and compatible Xcode Command Line Tools.'));
      try { resolveValue(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('REA native adapter returned invalid JSON.')); }
    });
    if (signal.aborted) stop();
  });
}

/** Original REA native session in the configured/bundled Node runtime; no deep-provider selection. */
export const observeDesktopWindow: ObserveDesktopWindow = async ({ launch, selection, screenshot, signal }) => {
  signal.throwIfAborted();
  const root = await mkdtemp(join(tmpdir(), 'rea-desktop-observer-'));
  try {
    const script = join(root, 'observer.mjs');
    await writeFile(script, DESKTOP_OBSERVER_JS, { flag: 'wx' });
    return await runObserver(launch.command, [script, JSON.stringify({ engineRoot: resolve(dirname(launch.args[0]), '..'),
      executable: selection.executable, pid: selection.pid, windowId: selection.windowId, screenshot, accessibility: !screenshot })], signal, root);
  } finally { await rm(root, { recursive: true, force: true }); }
};
