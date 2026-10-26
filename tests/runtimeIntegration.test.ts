import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { publishRuntime } from '../scripts/publish-runtime.mjs';

describe('runtime preparation and publication integration', () => {
  it('preserves the existing runtime when staged validation fails', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'rea-runtime-integration-')
    );

    try {
      const active = path.join(root, 'runtime');
      const staged = path.join(root, '.runtime-build-test', 'runtime');

      await mkdir(path.join(active, 'rea'), { recursive: true });
      await mkdir(path.join(active, 'node'), { recursive: true });

      await writeFile(
        path.join(active, 'rea', 'version.txt'),
        'existing-runtime'
      );

      await mkdir(path.join(staged, 'rea'), { recursive: true });
      const target = `${process.platform}-${process.arch}`;

      await mkdir(
        path.join(staged, 'node', target),
        { recursive: true }
      );

      await writeFile(
        path.join(staged, 'rea', 'distribution.json'),
        JSON.stringify({
          version: '0.0.0',
          platform: process.platform,
          arch: process.arch
        })
      );

      await expect(
        publishRuntime({ projectRoot: root, stagedRuntime: staged, target })
      ).rejects.toThrow('Unexpected REA version');

      const preserved = await readFile(
        path.join(active, 'rea', 'version.txt'),
        'utf8'
      );

      expect(preserved).toBe('existing-runtime');

      await expect(
        readFile(
          path.join(root, '.runtime-previous-active', 'rea', 'version.txt'),
          'utf8'
        )
      ).rejects.toThrow();

    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// These tests use the production validator and temporary release-shaped trees,
// including a copied Node executable. No protected runtime is published.
import { createValidStagedRuntime } from './fixtures/preparedRuntime';
import { lstat } from 'node:fs/promises';

it('rejects a corrupted candidate before moving the original active runtime or candidate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rea-publication-integrity-'));
  const target = `${process.platform}-${process.arch}`;
  const active = path.join(root, 'runtime');
  const staged = path.join(root, '.runtime-build-test', 'runtime');
  try {
    await createValidStagedRuntime(staged, target);
    await mkdir(active);
    await writeFile(path.join(active, 'sentinel'), 'old');
    await writeFile(path.join(staged, 'rea', 'engine.txt'), 'corrupted');
    const original = await lstat(staged);
    await expect(publishRuntime({ projectRoot: root, stagedRuntime: staged,
      target, preservePreviousRuntime: true })).rejects.toThrow('REA integrity mismatch');
    expect(await readFile(path.join(active, 'sentinel'), 'utf8')).toBe('old');
    expect(await readFile(path.join(staged, 'rea', 'engine.txt'), 'utf8')).toBe('corrupted');
    expect((await lstat(staged)).ino).toBe(original.ino);
    await expect(lstat(path.join(root, '.runtime-previous-active'))).rejects.toThrow();
    await expect(lstat(path.join(root, '.runtime-publish-lock'))).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.each([false, true])('uses full validation after placement and preserves the previous runtime (corrupt=%j)', async corrupt => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rea-publication-validated-'));
  const target = `${process.platform}-${process.arch}`;
  const active = path.join(root, 'runtime');
  const staged = path.join(root, '.runtime-build-test', 'runtime');
  try {
    await createValidStagedRuntime(staged, target);
    await mkdir(path.join(active, 'rea'), { recursive: true });
    await mkdir(path.join(active, 'node'));
    await writeFile(path.join(active, 'rea', 'sentinel'), 'old');
    const operation = publishRuntime({ projectRoot: root, stagedRuntime: staged,
      target, preservePreviousRuntime: true,
      onStep(step: string) {
        if (corrupt && step === 'runtime-published') {
          // The seam is synchronous; mutate only the temporary published fixture.
          writeFileSync(path.join(active, 'rea', 'engine.txt'), 'post-placement corruption');
        }
      } });
    if (corrupt) {
      await expect(operation).rejects.toThrow('REA integrity mismatch');
      expect(await readFile(path.join(active, 'rea', 'sentinel'), 'utf8')).toBe('old');
      expect(await readFile(path.join(root, '.runtime-failed-publish', 'rea', 'engine.txt'), 'utf8')).toBe('post-placement corruption');
    } else {
      expect((await operation).previousRuntimePreserved).toBe(true);
      expect(await readFile(path.join(root, '.runtime-previous-active', 'rea', 'sentinel'), 'utf8')).toBe('old');
      expect(await readFile(path.join(active, 'rea', 'engine.txt'), 'utf8')).toBe('REA candidate test engine');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
