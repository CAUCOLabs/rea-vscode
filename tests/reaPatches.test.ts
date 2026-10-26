import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';

const execute = promisify(execFile);
const project = path.resolve('.');
const active = path.join(project, 'runtime/rea');
const patchDirectory = path.join(project, 'patches/rea-6.7.0');
const moduleUrl = new URL('../scripts/apply-rea-patches.mjs', import.meta.url).href;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'rea-patch-test-')); temporary.push(root);
  const source = path.join(root, 'source');
  const assets = path.join(root, 'patches');
  await cp(patchDirectory, assets, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(assets, 'manifest.json'), 'utf8'));
  const patch = JSON.parse(await readFile(path.join(assets, manifest.patch.file), 'utf8'));
  await mkdir(source);
  const pkg = { name: 'rea-agents', version: '6.7.0', files: ['bridge', 'dist'], engines: { node: '>=26.0.0' }, dependencies: {} };
  await writeFile(path.join(source, 'package.json'), JSON.stringify(pkg));
  await cp(path.join(patchDirectory, 'LICENSE'), path.join(source, 'LICENSE'));
  for (const entry of manifest.applicationOrder) {
    await mkdir(path.dirname(path.join(source, entry.path)), { recursive: true });
    if (entry.operation === 'add') continue;
    // Derive fixtures from the installed vendored tree, but require the exact
    // recorded upstream hash. No network access or invented baseline is used.
    let bytes = await readFile(path.join(active, entry.path));
    if (sha(bytes) === entry.patchedSha256) {
      const edits = patch.files.find((file: any) => file.path === entry.path).edits;
      const pieces: Buffer[] = [];
      let cursor = 0, delta = 0;
      for (const edit of edits) {
        const offset = edit.offset + delta;
        const before = Buffer.from(edit.before), after = Buffer.from(edit.after);
        expect(bytes.subarray(offset, offset + after.length)).toEqual(after);
        pieces.push(bytes.subarray(cursor, offset), before);
        cursor = offset + after.length;
        delta += after.length - before.length;
      }
      pieces.push(bytes.subarray(cursor)); bytes = Buffer.concat(pieces);
    }
    expect(sha(bytes)).toBe(entry.originalSha256);
    await writeFile(path.join(source, entry.path), bytes);
  }
  await writeFile(path.join(source, 'unrelated.txt'), 'keep this exact content');
  return { root, source, assets, manifest, patch, pkg };
}
async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else files[path.relative(root, file)] = sha(await readFile(file));
    }
  }
  await visit(root); return files;
}
async function activeSnapshot() {
  const manifest = JSON.parse(await readFile(path.join(patchDirectory, 'manifest.json'), 'utf8'));
  const entries = ['distribution.json', ...manifest.applicationOrder.map((entry: any) => entry.path)];
  return Promise.all(entries.map(async relative => sha(await readFile(path.join(active, relative)))));
}

it('applies exact baseline patches and verifies all output hashes without touching unrelated files', async () => {
  const { source, assets, manifest } = await fixture();
  const { applyReaPatch, prepareReaPatch } = await import(moduleUrl);
  const before = await snapshot(source);
  await prepareReaPatch(source, assets);
  expect(await snapshot(source)).toEqual(before);
  const applied = await applyReaPatch(source, assets);
  expect(applied.manifestSha256).toBe(sha(await readFile(path.join(assets, 'manifest.json'))));
  for (const entry of manifest.applicationOrder) expect(sha(await readFile(path.join(source, entry.path)))).toBe(entry.patchedSha256);
  expect(await readFile(path.join(source, 'unrelated.txt'), 'utf8')).toBe('keep this exact content');
  const patched = await snapshot(source);
  await expect(applyReaPatch(source, assets)).rejects.toThrow('original SHA-256 mismatch');
  expect(await snapshot(source)).toEqual(patched);
});

it.each(['version', 'name'])('rejects an incorrect REA package %s without writes', async field => {
  const { source, assets, pkg } = await fixture();
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ ...pkg, [field]: field === 'version' ? '6.7.1' : 'other' }));
  const before = await snapshot(source);
  const { applyReaPatch } = await import(moduleUrl);
  await expect(applyReaPatch(source, assets)).rejects.toThrow('requires rea-agents@6.7.0');
  expect(await snapshot(source)).toEqual(before);
});

it.each(['modified baseline', 'partially patched edit', 'preexisting addition'])('rejects %s without any writes', async state => {
  const { source, assets, manifest } = await fixture();
  const entry = manifest.applicationOrder[state === 'preexisting addition' ? 2 : 0];
  const bytes = state === 'modified baseline' ? Buffer.from('unrelated local modification') : await readFile(path.join(active, entry.path));
  await writeFile(path.join(source, entry.path), bytes);
  const before = await snapshot(source);
  const { applyReaPatch } = await import(moduleUrl);
  await expect(applyReaPatch(source, assets)).rejects.toThrow(/original SHA-256 mismatch|new file must be absent/);
  expect(await snapshot(source)).toEqual(before);
});

it.each(['patch asset', 'new source', 'expected output', 'exact edit'])('rejects corrupted %s before writing any file', async state => {
  const { source, assets, manifest, patch } = await fixture();
  if (state === 'patch asset') await writeFile(path.join(assets, manifest.patch.file), '{}');
  if (state === 'new source') await writeFile(path.join(assets, 'NativeExecutableIdentity.swift'), 'corrupted');
  if (state === 'expected output') manifest.applicationOrder[1].patchedSha256 = '0'.repeat(64);
  if (state === 'exact edit') {
    patch.files[0].edits[0].before = 'not the exact upstream bytes';
    const bytes = Buffer.from(JSON.stringify(patch));
    await writeFile(path.join(assets, manifest.patch.file), bytes);
    manifest.patch.sha256 = sha(bytes);
  }
  await writeFile(path.join(assets, 'manifest.json'), JSON.stringify(manifest));
  const before = await snapshot(source);
  const { applyReaPatch } = await import(moduleUrl);
  await expect(applyReaPatch(source, assets)).rejects.toThrow(/SHA-256 mismatch|exact edit bytes/);
  expect(await snapshot(source)).toEqual(before);
});

it('vendors into a temporary destination and inventories all patched files and patch provenance', async () => {
  const { root, source, manifest } = await fixture();
  const destination = path.join(root, 'runtime/rea');
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'previous.txt'), 'old fixture runtime');
  await execute(process.execPath, [path.join(project, 'scripts/vendor-engine.mjs'), source], { cwd: root });
  const inventory = JSON.parse(await readFile(path.join(destination, 'distribution.json'), 'utf8'));
  expect(inventory.version).toBe('6.7.0');
  expect(inventory.patches).toEqual([{ id: 'rea-6.7.0/native-executable-verification',
    manifestSha256: sha(await readFile(path.join(patchDirectory, 'manifest.json'))) }]);
  for (const entry of manifest.applicationOrder) {
    const output = await readFile(path.join(destination, entry.path));
    expect(sha(output)).toBe(entry.patchedSha256);
    expect(inventory.files[entry.path]).toBe(entry.patchedSha256);
  }
  expect(inventory.files.LICENSE).toBe(sha(await readFile(path.join(patchDirectory, 'LICENSE'))));
  for (const [relative, expected] of Object.entries(inventory.files)) expect(sha(await readFile(path.join(destination, relative)))).toBe(expected);
  expect(await readdir(path.join(root, 'runtime'))).toEqual(['rea']);
});


it('vendors REA to an isolated destination without modifying the default runtime', async () => {
  const { root, source } = await fixture();
  const destination = path.join(root, 'isolated-runtime', 'rea');

  const before = await activeSnapshot();

  await execute(
    process.execPath,
    [path.join(project, 'scripts/vendor-engine.mjs'), source],
    {
      cwd: root,
      env: {
        ...process.env,
        REA_VENDOR_DESTINATION: destination
      }
    }
  );

  const inventory = JSON.parse(
    await readFile(path.join(destination, 'distribution.json'), 'utf8')
  );

  expect(inventory.version).toBe('6.7.0');
  expect(inventory.patches).toEqual([
    expect.objectContaining({
      id: 'rea-6.7.0/native-executable-verification'
    })
  ]);

  expect(await activeSnapshot()).toEqual(before);
  expect(await readdir(path.join(root, 'isolated-runtime'))).toEqual(['rea']);
});

it.each(['invalid baseline', 'missing dependency'])('preserves the destination and active runtime on vendoring failure: %s', async failure => {
  const { root, source, pkg } = await fixture();
  const destination = path.join(root, 'runtime/rea');
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'sentinel.txt'), 'do not replace on failure');
  if (failure === 'invalid baseline') await writeFile(path.join(source, 'dist/native/NativeUiHelperRuntime.js'), 'local changes');
  else await writeFile(path.join(source, 'package.json'), JSON.stringify({ ...pkg, dependencies: { 'rea-owned-missing-fixture-dependency': '0.0.0' } }));
  const before = await snapshot(destination), activeBefore = await activeSnapshot();
  await expect(execute(process.execPath, [path.join(project, 'scripts/vendor-engine.mjs'), source], { cwd: root })).rejects.toThrow();
  expect(await snapshot(destination)).toEqual(before);
  expect(await activeSnapshot()).toEqual(activeBefore);
  expect(await readdir(path.join(root, 'runtime'))).toEqual(['rea']);
});
