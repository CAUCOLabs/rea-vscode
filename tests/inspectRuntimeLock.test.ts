import { describe, expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectRuntimeLock } from '../scripts/inspect-runtime-lock.mjs';
import { withRuntimePublicationLock } from '../scripts/runtime-lock.mjs';

async function fixture() {
  return mkdtemp(path.join(os.tmpdir(), 'rea-lock-inspection-test-'));
}

describe('runtime lock inspection', () => {
  it('reports unlocked when no lock exists', async () => {
    const root = await fixture();

    try {
      const result = await inspectRuntimeLock(root);

      expect(result.status).toBe('unlocked');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports active for a currently held lock without changing metadata', async () => {
    const root = await fixture();

    try {
      await withRuntimePublicationLock(root, async () => {
        const ownerPath = path.join(
          root,
          '.runtime-publish-lock',
          'owner.json'
        );

        const before = await readFile(ownerPath, 'utf8');

        const result = await inspectRuntimeLock(root);

        const after = await readFile(ownerPath, 'utf8');

        expect(result.status).toBe('active');
        expect(result.reason).toBe('owner-pid-exists');
        expect(result.owner.pid).toBe(process.pid);
        expect(after).toBe(before);
      });

      expect(await readdir(root)).not.toContain('.runtime-publish-lock');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports stale-candidate when the owner PID does not exist', async () => {
    const root = await fixture();
    const lockDirectory = path.join(root, '.runtime-publish-lock');

    try {
      await mkdir(lockDirectory);

      const owner = {
        schemaVersion: 1,
        operationId: 'test-stale-operation',
        pid: 99999999,
        ppid: 1,
        hostname: os.hostname(),
        acquiredAt: new Date().toISOString()
      };

      const ownerPath = path.join(lockDirectory, 'owner.json');
      const original = JSON.stringify(owner);

      await writeFile(ownerPath, original);

      const result = await inspectRuntimeLock(root);

      expect(result.status).toBe('stale-candidate');
      expect(result.reason).toBe('owner-pid-not-found');
      expect(await readFile(ownerPath, 'utf8')).toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports unknown when owner metadata is missing', async () => {
    const root = await fixture();

    try {
      await mkdir(path.join(root, '.runtime-publish-lock'));

      const result = await inspectRuntimeLock(root);

      expect(result.status).toBe('unknown');
      expect(result.reason).toBe('missing-or-invalid-owner-metadata');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports unknown when owner metadata is invalid', async () => {
    const root = await fixture();
    const lockDirectory = path.join(root, '.runtime-publish-lock');

    try {
      await mkdir(lockDirectory);
      await writeFile(
        path.join(lockDirectory, 'owner.json'),
        JSON.stringify({
          schemaVersion: 1,
          pid: -5,
          hostname: os.hostname(),
          operationId: 'invalid',
          acquiredAt: new Date().toISOString()
        })
      );

      const result = await inspectRuntimeLock(root);

      expect(result.status).toBe('unknown');
      expect(result.reason).toBe('invalid-owner-metadata');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a symbolic-link lock directory without following it', async () => {
    const root = await fixture();
    const target = path.join(root, 'target');

    try {
      await mkdir(target);
      await symlink(target, path.join(root, '.runtime-publish-lock'));

      const result = await inspectRuntimeLock(root);

      expect(result.status).toBe('unknown');
      expect(result.reason).toBe('invalid-lock-directory');
      expect(await readdir(target)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
