import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  withRuntimePublicationLock
} from '../scripts/runtime-lock.mjs';

async function fixture() {
  return mkdtemp(path.join(os.tmpdir(), 'rea-runtime-lock-test-'));
}

describe('exclusive runtime publication lock', () => {
  it('acquires and releases the lock successfully', async () => {
    const root = await fixture();

    try {
      const result = await withRuntimePublicationLock(
        root,
        async () => 'completed'
      );

      expect(result).toBe('completed');

      const entries = await readdir(root);
      expect(entries).not.toContain('.runtime-publish-lock');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a concurrent publication', async () => {
    const root = await fixture();

    let release!: () => void;

    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      let signalStarted!: () => void;

      const started = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });

      const first = withRuntimePublicationLock(root, async () => {
        signalStarted();
        await waiting;
      });

      await started;

      try {
        await expect(
          withRuntimePublicationLock(root, async () => 'second')
        ).rejects.toThrow('Runtime publication already in progress');
      } finally {
        release();
        await first;
      }
    } finally {
      release?.();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('releases the lock after an operation throws', async () => {
    const root = await fixture();

    try {
      await expect(
        withRuntimePublicationLock(root, async () => {
          throw new Error('Simulated publication failure');
        })
      ).rejects.toThrow('Simulated publication failure');

      const result = await withRuntimePublicationLock(
        root,
        async () => 'recovered'
      );

      expect(result).toBe('recovered');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite an abandoned lock', async () => {
    const root = await fixture();

    try {
      const lock = path.join(root, '.runtime-publish-lock');
      await mkdir(lock);

      await expect(
        withRuntimePublicationLock(root, async () => 'unsafe')
      ).rejects.toThrow('lock requires recovery');

      const entries = await readdir(root);
      expect(entries).toContain('.runtime-publish-lock');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('runtime lock ownership metadata', () => {
  it('records ownership information while the lock is held', async () => {
    const root = await fixture();

    try {
      await withRuntimePublicationLock(root, async () => {
        const ownerPath = path.join(
          root,
          '.runtime-publish-lock',
          'owner.json'
        );

        const owner = JSON.parse(await readFile(ownerPath, 'utf8'));

        expect(owner.schemaVersion).toBe(1);
        expect(owner.pid).toBe(process.pid);
        expect(owner.ppid).toBe(process.ppid);
        expect(owner.hostname).toBe(os.hostname());
        expect(owner.operationId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
        expect(Number.isNaN(Date.parse(owner.acquiredAt))).toBe(false);

        await expect(
          withRuntimePublicationLock(root, async () => 'second')
        ).rejects.toThrow('Runtime publication already in progress');

        const unchanged = JSON.parse(
          await readFile(ownerPath, 'utf8')
        );

        expect(unchanged).toEqual(owner);
      });

      expect(await readdir(root)).not.toContain('.runtime-publish-lock');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes ownership metadata after an operation fails', async () => {
    const root = await fixture();

    try {
      await expect(
        withRuntimePublicationLock(root, async () => {
          throw new Error('Simulated failure');
        })
      ).rejects.toThrow('Simulated failure');

      expect(await readdir(root)).not.toContain('.runtime-publish-lock');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
