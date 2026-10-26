// Packaging-only policy for the exact upstream rea-agents@6.7.0 release.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstat, readFile, writeFile, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const securityVersions = Object.freeze({
  'fast-uri': '3.1.9', zod: '4.6.7', ajv: '8.20.0'
});
const upstreamManifestSha256 = '3f6c47fb12c8388f291a21e7f99a876495d03aee671b3b6a0708dd12d6ebb570';
const integrities = {
  'fast-uri': 'sha512-hS/0Wt3Ya043oKXs0sIxrMpKQITXhMLIrVAKKXi4gozGC9v7YRWVnXIZzjNPTO02M9BdxLCWqK1yRXgNziVyJQ==',
  zod: 'sha512-g8W2D2kU6a8untc053fX1uVBKzM7yqAxW/3zwk83+6RyF2+SKOuV+c0wBDhUwzV1PaGapmZH+rmcUzPf+3CGwg=='
};
const retainedLock = fileURLToPath(new URL('../build/rea-package-lock.json', import.meta.url));

export function remediateReaManifest(originalBytes, lock) {
  if (createHash('sha256').update(originalBytes).digest('hex') !== upstreamManifestSha256) {
    throw new Error('Unexpected upstream REA manifest; security policy requires review');
  }
  const manifest = JSON.parse(originalBytes.toString());
  manifest.dependencies.zod = securityVersions.zod;
  // npm rejects a conflicting override of an exact direct dependency. $zod
  // references the adjusted direct spec and also pins transitive consumers.
  manifest.overrides = { ...manifest.overrides, 'fast-uri': securityVersions['fast-uri'], zod: '$zod' };
  manifest.reaVscodeDependencyPolicy = 1;
  if (lock.name !== manifest.name || lock.version !== manifest.version || lock.lockfileVersion !== 3) {
    throw new Error('Unexpected REA lockfile identity');
  }
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const entries = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
    if (entries(manifest[section]) !== entries(lock.packages[''][section])) {
      throw new Error(`REA manifest/lockfile mismatch: ${section}`);
    }
  }
  for (const [name, version] of Object.entries(securityVersions)) {
    const records = Object.entries(lock.packages).filter(([key]) => key.endsWith(`/node_modules/${name}`) || key === `node_modules/${name}`);
    if (!records.length || records.some(([, record]) => record.version !== version)) {
      throw new Error(`Unexpected locked security dependency: ${name}`);
    }
    const record = lock.packages[`node_modules/${name}`];
    if (integrities[name] && (record.integrity !== integrities[name] ||
      record.resolved !== `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`)) {
      throw new Error(`Unexpected security dependency integrity: ${name}`);
    }
  }
  return manifest;
}

export async function prepareReaSecurityDependencies(source) {
  const manifestPath = path.join(source, 'package.json');
  if (!(await lstat(manifestPath)).isFile()) throw new Error('Expected regular REA manifest');
  const lockBytes = await readFile(retainedLock);
  const manifest = remediateReaManifest(await readFile(manifestPath), JSON.parse(lockBytes));
  // source is a disposable extraction owned by the preparation operation.
  // All policy checks complete before either write; npm ci never runs on failure.
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(source, 'package-lock.json'), lockBytes);
}

export async function verifyReaSecurityDependencies(source) {
  source = await realpath(source);
  const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  if (manifest.name !== 'rea-agents' || manifest.version !== '6.7.0' ||
    manifest.reaVscodeDependencyPolicy !== 1 || manifest.dependencies.zod !== securityVersions.zod ||
    manifest.dependencies.ajv !== securityVersions.ajv ||
    manifest.overrides?.zod !== '$zod' || manifest.overrides?.['fast-uri'] !== securityVersions['fast-uri']) {
    throw new Error('Unexpected REA security dependency policy');
  }
  const require = createRequire(path.join(source, 'package.json'));
  for (const [name, version] of Object.entries(securityVersions)) {
    const filename = require.resolve(`${name}/package.json`);
    const installed = JSON.parse(await readFile(filename, 'utf8'));
    const relative = path.relative(path.join(source, 'node_modules'), filename);
    if (relative.startsWith('..') || path.isAbsolute(relative) ||
      installed.version !== version ||
      installed.name !== name) {
      throw new Error(`Unexpected installed security dependency: ${name}`);
    }
  }
  // Check every installed nested copy, not just the hoisted root packages.
  async function inspectModules(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const packageRoot = path.join(directory, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Unexpected dependency entry: ${packageRoot}`);
      if (entry.name.startsWith('@')) { await inspectModules(packageRoot); continue; }
      const pkg = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
      if (Object.hasOwn(securityVersions, entry.name) &&
        (pkg.name !== entry.name || pkg.version !== securityVersions[entry.name])) {
        throw new Error(`Unexpected installed security dependency: ${entry.name}`);
      }
      await inspectModules(path.join(packageRoot, 'node_modules'));
    }
  }
  await inspectModules(path.join(source, 'node_modules'));

  const ajvRequire = createRequire(require.resolve('ajv/package.json'));
  if (JSON.parse(await readFile(ajvRequire.resolve('fast-uri/package.json'), 'utf8')).version !== securityVersions['fast-uri']) {
    throw new Error('Unexpected AJV fast-uri dependency');
  }
}
