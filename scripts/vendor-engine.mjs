// Read-only import of an already built upstream release. Never runs upstream hooks.
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, readdir, rename, lstat, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { applyReaPatch, prepareReaPatch } from './apply-rea-patches.mjs';
const source = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/vendor-engine.mjs /path/to/built/rea');
const destination = path.resolve('runtime/rea');
if (source === destination || source.startsWith(destination + path.sep) || destination.startsWith(source + path.sep)) throw new Error('Source and destination must be separate trees');
const pkg = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
// Validate originals and every computed patch output before touching the destination.
await prepareReaPatch(source);
await mkdir(path.dirname(destination), { recursive: true });
const target = await mkdtemp(path.join(path.dirname(destination), '.rea-vendor-'));
let previous;
let published = false;
try {
for (const entry of ['package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'DISCLAIMER.md', 'licenses', ...pkg.files]) {
  if (entry === 'scripts/verify-windows-native-artifact.mjs') continue;
  if (entry === 'native/windows/README.md') continue;
  if (entry.startsWith('native/windows/') && process.platform !== 'win32') continue;
  if (['package.json','LICENSE','THIRD_PARTY_NOTICES.md','DISCLAIMER.md','licenses'].includes(entry) || !/^(install\.sh|scripts\/(prepack|prepare)\.mjs|README\.md)$/.test(entry)) {
    try { await cp(path.join(source, entry), path.join(target, entry), { recursive: true, dereference: true, filter: p => !/\.(map|tsbuildinfo)$/.test(p) }); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
// Follow installed production dependency resolution, preserving nested versions.
const copied = new Set();
async function dependency(name, from, destination) {
  let dir = from, found;
  while (true) {
    const candidate = path.join(dir, 'node_modules', name);
    try { await stat(path.join(candidate, 'package.json')); found = candidate; break; } catch {}
    const parent = path.dirname(dir); if (parent === dir) throw new Error(`Missing dependency ${name} from ${from}`); dir = parent;
  }
  const relative = path.relative(path.join(source, 'node_modules'), found);
  if (relative.startsWith('..')) throw new Error(`Dependency outside upstream installation: ${found}`);
  const dest = path.join(target, 'node_modules', relative);
  if (copied.has(found)) return; copied.add(found);
    await cp(found, dest, { recursive: true, dereference: true, filter: p => !/(^|[/\\])(test|tests|\.github)([/\\]|$)/.test(p) && !/\.(map|tsbuildinfo)$/.test(p) });
  const metadata = JSON.parse(await readFile(path.join(found, 'package.json'), 'utf8'));
  for (const dep of Object.keys(metadata.dependencies || {})) await dependency(dep, found);
  for (const dep of Object.keys(metadata.optionalDependencies || {})) {
    if (dep === 'frida') continue;
    try { await dependency(dep, found); } catch (e) { if (!e.message.startsWith('Missing dependency')) throw e; }
  }
}
for (const name of Object.keys(pkg.dependencies)) await dependency(name, source);
const appliedPatch = await applyReaPatch(target);
const files = {};
async function inventory(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) {
 const file = path.join(dir, entry.name); if (entry.isDirectory()) await inventory(file);
 else files[path.relative(target,file).split(path.sep).join('/')] = createHash('sha256').update(await readFile(file)).digest('hex');
} }
await inventory(target);
await writeFile(path.join(target,'distribution.json'), JSON.stringify({ version: pkg.version, node: pkg.engines.node, platform: process.platform, arch: process.arch, excludedOptionalDependencies: ['frida'], patches: [appliedPatch], files }, null, 2));
// Publish only a complete, patched, inventoried tree. Keep the previous tree
// available for rollback until the staged tree has been renamed into place.
let existing;
try { existing = await lstat(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing) {
  if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Runtime destination must be a real directory');
  previous = await mkdtemp(path.join(path.dirname(destination), '.rea-previous-'));
  await rename(destination, path.join(previous, 'rea'));
}
try {
  await rename(target, destination);
  published = true;
} catch (error) {
  if (previous) {
    await rename(path.join(previous, 'rea'), destination);
  }
  throw error;
}
console.log(`Vendored REA ${pkg.version}: ${Object.keys(files).length} files, ${copied.size} production packages`);
} finally {
  if (!published) await rm(target, { recursive: true, force: true });
  // If rollback itself failed, retain the previous runtime for manual recovery.
  if (previous) {
    let retained = false;
    try { await lstat(path.join(previous, 'rea')); retained = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (published || !retained) await rm(previous, { recursive: true, force: true });
  }
}
