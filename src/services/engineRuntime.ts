import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let extensionRoot = '';
export function initializeEngineRuntime(root: string) { extensionRoot = root; }
export function bundledNodePath(root = extensionRoot, platform = process.platform, arch = process.arch): string {
  if (!root) throw new Error('REA extension runtime has not been initialized.');
  const target = `${platform}-${arch}`;
  return platform === 'win32'
    ? path.join(root, 'runtime', 'node', target, 'node.exe')
    : path.join(root, 'runtime', 'node', target, 'bin', 'node');
}
export function engineScript(override = '', root = extensionRoot): string {
  if (override.trim()) {
    if (!path.isAbsolute(override.trim())) throw new Error('REA scriptPath must be absolute.');
    return override.trim();
  }
  if (!root) throw new Error('REA extension runtime has not been initialized.');
  return path.join(root, 'runtime', 'rea', 'scripts', 'rea.mjs');
}
export function compatibleNode(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return false;
  const [, major, minor] = match.map(Number);
  return major >= 26 || major === 24 && minor >= 11 || major === 22 && minor >= 19;
}
export const runtimeHelp = 'The bundled Node.js runtime was unavailable and no compatible system Node.js was found. Install Node.js ^22.19, ^24.11 or >=26 from https://nodejs.org/en/download, then run REA: Set Up REA.';
export async function detectRuntime(executable = 'node', candidates?: string[]): Promise<string> {
  const bundled = extensionRoot ? bundledNodePath() : '';
  const configured = executable.trim();
  const system = [
    'node', '/opt/homebrew/bin/node', '/usr/local/bin/node',
    path.join(os.homedir(), '.volta', 'bin', 'node'),
    ...(process.platform === 'win32' ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe')] : [])
  ];
  const commands = candidates ?? [...new Set([
    ...(configured && configured !== 'node' ? [configured] : []),
    ...(bundled ? [bundled] : []),
    ...system
  ])];
  for (const command of [...new Set(commands)]) {
    try {
      const result = await new Promise<string>((resolve, reject) => execFile(command,
        ['-p', 'JSON.stringify({version:process.version,execPath:process.execPath,node:!process.versions.electron})'],
        { timeout: 5000, maxBuffer: 4096, shell: false }, (error, stdout) => error ? reject(error) : resolve(stdout)));
      const runtime = JSON.parse(result.trim());
      if (runtime.node && compatibleNode(runtime.version) && path.isAbsolute(runtime.execPath)) return runtime.execPath;
    } catch { /* Try the next standard runtime location. */ }
  }
  throw new Error(`No compatible Node.js runtime found. ${runtimeHelp}`);
}
export async function resolveEngineLaunch(executable = 'node', override = '') {
  const script = engineScript(override);
  try { await access(script); } catch { throw new Error('REA packaged engine is missing. Reinstall the extension or check the optional rea.scriptPath override.'); }
  return { command: await detectRuntime(executable), args: [script, '--mcp'] };
}
