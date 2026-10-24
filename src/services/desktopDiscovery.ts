import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { DESKTOP_DISCOVERY_SWIFT } from '../native/desktopDiscoverySource';

export interface DesktopWindow { id: number; title: string; bounds: { X: number; Y: number; Width: number; Height: number } }
export interface DesktopApplication { pid: number; name: string; bundleId: string | null; executable: string; launchTime: number | null; windows: DesktopWindow[] }
export interface DesktopSelection { pid: number; executable: string; launchTime: number; windowId: number }
export interface DesktopDiscovery {
  applications: DesktopApplication[]; permissions: { accessibility: boolean; screenCapture: boolean };
  windowServerAvailable: boolean; truncated: boolean;
  menu: { status: 'not-requested' | 'captured' | 'unavailable' | 'permission-denied'; items: { title: string | null; role: string | null }[]; scope?: string };
}
export type DiscoverDesktop = (signal: AbortSignal, selection?: DesktopSelection) => Promise<DesktopDiscovery>;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length <= max && !v.includes('\0');
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
export function parseDesktopDiscovery(value: unknown): DesktopDiscovery {
  if (object(value) && typeof value.error === 'string') throw new Error(value.error.slice(0, 4096));
  if (!object(value) || !Array.isArray(value.applications) || value.applications.length > 256 || !object(value.permissions) ||
      typeof value.permissions.accessibility !== 'boolean' || typeof value.permissions.screenCapture !== 'boolean' ||
      typeof value.windowServerAvailable !== 'boolean' || typeof value.truncated !== 'boolean') throw new Error('Invalid macOS application discovery response.');
  for (const app of value.applications) {
    if (!object(app) || !positive(app.pid) || !text(app.name, 256) || !text(app.executable) || !isAbsolute(app.executable) ||
        !(app.bundleId === null || text(app.bundleId)) || !(app.launchTime === null || (typeof app.launchTime === 'number' && Number.isFinite(app.launchTime) && app.launchTime > 0)) ||
        !Array.isArray(app.windows) || app.windows.length > 128) throw new Error('Invalid macOS application identity.');
    const windows = new Set<number>();
    for (const window of app.windows) {
      if (!object(window) || !positive(window.id) || windows.has(window.id) || !text(window.title) || !object(window.bounds) ||
          !['X', 'Y', 'Width', 'Height'].every(key => typeof window.bounds[key] === 'number' && Number.isFinite(window.bounds[key])) ||
          window.bounds.Width <= 0 || window.bounds.Height <= 0) throw new Error('Invalid macOS window identity.');
      windows.add(window.id);
    }
  }
  if (new Set(value.applications.map(app => app.pid)).size !== value.applications.length) throw new Error('Duplicate macOS application identity.');
  const menu = value.menu;
  if (!object(menu) || !['not-requested', 'captured', 'unavailable', 'permission-denied'].includes(menu.status) || !Array.isArray(menu.items) || menu.items.length > 40 ||
      menu.items.some(item => !object(item) || !(item.title === null || text(item.title)) || !(item.role === null || text(item.role)))) throw new Error('Invalid application menu response.');
  return value as DesktopDiscovery;
}

export function runDesktopHelper(command: string, args: string[], signal: AbortSignal, timeout: number, maxBuffer: number, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => execFile(command, args, { signal, timeout, maxBuffer, shell: false, cwd,
    env: { ...process.env, TMPDIR: cwd } }, (error, stdout) => error ? reject(new Error(signal.aborted ? 'Desktop discovery cancelled.' : 'macOS discovery helper failed or timed out. macOS 14 or later, compatible Xcode Command Line Tools and a local GUI session are required.')) : resolve(stdout)));
}

/** Only compile and execute the extension's fixed discovery helper; no application launch or AX actions. */
export const discoverDesktopApplications: DiscoverDesktop = async (signal, selection) => {
  if (process.platform !== 'darwin') throw new Error('Desktop Application Analysis currently requires a local macOS extension host.');
  signal.throwIfAborted();
  const root = await mkdtemp(join(tmpdir(), 'rea-desktop-discovery-'));
  const combined = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
  try {
    const source = join(root, 'main.swift'), output = join(root, 'discovery');
    await writeFile(source, DESKTOP_DISCOVERY_SWIFT, { flag: 'wx' });
    await runDesktopHelper('/usr/bin/xcrun', ['swiftc', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`, '-module-cache-path', join(root, 'modules'), source, '-o', output], combined, 45000, 1024 * 1024, root);
    const response = await runDesktopHelper(output, selection ? [JSON.stringify(selection)] : [], combined, 10000, 2 * 1024 * 1024, root);
    let value: unknown;
    try { value = JSON.parse(response); } catch { throw new Error('macOS discovery helper returned invalid JSON.'); }
    return parseDesktopDiscovery(value);
  } finally { await rm(root, { recursive: true, force: true }); }
};
