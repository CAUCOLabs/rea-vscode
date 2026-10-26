import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { remediateReaManifest, prepareReaSecurityDependencies, verifyReaSecurityDependencies, securityVersions } from '../scripts/rea-security-dependencies.mjs';

const original = await readFile(new URL('./fixtures/rea-6.7.0-package.json', import.meta.url));
const lock = JSON.parse(await readFile(new URL('../build/rea-package-lock.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(lock);

describe('packaging dependency security policy', () => {
  it('adjusts only Zod, controlled overrides and the provenance marker in the upstream manifest', () => {
    const upstream = JSON.parse(original.toString());
    const result = remediateReaManifest(original, lock);
    expect(result).toEqual({ ...upstream, dependencies: { ...upstream.dependencies, zod: '4.6.7' },
      overrides: { ...upstream.overrides, 'fast-uri': '3.1.9', zod: '$zod' }, reaVscodeDependencyPolicy: 1 });
    expect(JSON.parse(original.toString()).dependencies.zod).toBe('4.4.3');
    for (const [name, version] of Object.entries(securityVersions)) {
      expect(lock.packages[`node_modules/${name}`].version).toBe(version);
    }
    expect(result.version).toBe('6.7.0');
  });

  it('preserves the entire original lock graph except the two remediated records and root Zod spec', () => {
    const preserved = clone();
    delete preserved.packages['node_modules/zod'];
    delete preserved.packages['node_modules/fast-uri'];
    // Recorded from the pre-remediation retained lock, with only its root Zod
    // declaration normalized to the reviewed replacement.
    expect(createHash('sha256').update(JSON.stringify(preserved)).digest('hex'))
      .toBe('67ac638c4947aef31c9e6f971df9ce525c73fee375879af4a0b01badb6f9573d');
  });

  it('rejects any unexpected upstream manifest before adjusting dependencies', () => {
    expect(() => remediateReaManifest(Buffer.from(original.toString().replace('4.4.3', '4.4.4')), lock)).toThrow('Unexpected upstream');
  });

  it.each(['dependencies', 'devDependencies', 'optionalDependencies'])('rejects manifest/lockfile mismatch in %s', section => {
    const bad = clone(); bad.packages[''][section].unexpected = '1.0.0';
    expect(() => remediateReaManifest(original, bad)).toThrow('manifest/lockfile mismatch');
  });

  it.each(['fast-uri', 'zod', 'ajv'])('rejects unexpected locked %s versions', name => {
    const bad = clone(); bad.packages[`node_modules/${name}`].version = '0.0.0';
    expect(() => remediateReaManifest(original, bad)).toThrow('Unexpected locked security dependency');
  });

  it.each(['fast-uri', 'zod'])('rejects corrupted %s integrity or download location', name => {
    for (const field of ['integrity', 'resolved']) {
      const bad = clone(); bad.packages[`node_modules/${name}`][field] = 'untrusted';
      expect(() => remediateReaManifest(original, bad)).toThrow('Unexpected security dependency integrity');
    }
  });

  it('rejects vulnerable nested lockfile copies', () => {
    const bad = clone(); bad.packages['node_modules/example/node_modules/zod'] = { version: '4.4.3' };
    expect(() => remediateReaManifest(original, bad)).toThrow('Unexpected locked security dependency');
  });

  it('writes a consistent manifest and exact retained lockfile into a disposable extraction', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rea-security-policy-'));
    try {
      await writeFile(path.join(root, 'package.json'), original);
      await prepareReaSecurityDependencies(root);
      expect(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))).toEqual(remediateReaManifest(original, lock));
      expect(await readFile(path.join(root, 'package-lock.json'))).toEqual(await readFile(new URL('../build/rea-package-lock.json', import.meta.url)));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects unexpected installed root and nested versions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rea-security-installed-'));
    try {
      await writeFile(path.join(root, 'package.json'), JSON.stringify(remediateReaManifest(original, lock)));
      for (const [name, version] of Object.entries(securityVersions)) {
        await mkdir(path.join(root, 'node_modules', name), { recursive: true });
        await writeFile(path.join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
      }
      await verifyReaSecurityDependencies(root);
      const zod = path.join(root, 'node_modules', 'zod', 'package.json');
      await writeFile(zod, JSON.stringify({ name: 'zod', version: '4.4.3' }));
      await expect(verifyReaSecurityDependencies(root)).rejects.toThrow('Unexpected installed security dependency: zod');
      await writeFile(zod, JSON.stringify({ name: 'zod', version: '4.6.7' }));
      const nested = path.join(root, 'node_modules', 'ajv', 'node_modules', 'fast-uri');
      await mkdir(nested, { recursive: true });
      await writeFile(path.join(nested, 'package.json'), JSON.stringify({ name: 'fast-uri', version: '3.1.8' }));
      await expect(verifyReaSecurityDependencies(root)).rejects.toThrow('Unexpected installed security dependency: fast-uri');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
