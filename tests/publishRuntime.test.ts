import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publishRuntime, recoverInterruptedRuntime } from '../scripts/publish-runtime.mjs';

const target = 'darwin-arm64';
// Structural fixtures intentionally omit release metadata. Only these controlled
// unit calls inject validation; production integration tests use the default.
const fixtureValidation = async () => ({ valid: true });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rea-publish-test-'));
  const active = path.join(root, 'runtime');
  const staged = path.join(root, '.runtime-build-test', 'runtime');

  async function createRuntime(directory: string, version: string) {
    await mkdir(path.join(directory, 'rea'), { recursive: true });
    await mkdir(path.join(directory, 'node'), { recursive: true });

    await writeFile(path.join(directory, 'rea', 'version.txt'), version);
    await writeFile(path.join(directory, 'node', 'version.txt'), version);
  }

  return { root, active, staged, createRuntime };
}


describe('interrupted runtime recovery', () => {
  it('restores the previous runtime when the active runtime is missing', async () => {
    const f = await fixture();

    try {
      const backup = path.join(f.root, '.runtime-previous-active');
      await f.createRuntime(backup, 'old');

      const result = await recoverInterruptedRuntime(f.root);

      expect(result).toEqual({
        recovered: true,
        reason: 'restored-previous-runtime'
      });

      expect(
        await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')
      ).toBe('old');

      expect(
        await readFile(path.join(f.active, 'node', 'version.txt'), 'utf8')
      ).toBe('old');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('does not overwrite an existing runtime', async () => {
    const f = await fixture();

    try {
      const backup = path.join(f.root, '.runtime-previous-active');

      await f.createRuntime(f.active, 'new');
      await f.createRuntime(backup, 'old');

      const result = await recoverInterruptedRuntime(f.root);

      expect(result.recovered).toBe(false);
      expect(result.reason).toBe('runtime-already-present');

      expect(
        await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')
      ).toBe('new');

      expect(
        await readFile(path.join(backup, 'rea', 'version.txt'), 'utf8')
      ).toBe('old');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('preserves both runtimes after interruption following publication', async () => {
    const f = await fixture();

    try {
      const backup = path.join(f.root, '.runtime-previous-active');

      await f.createRuntime(f.active, 'new');
      await f.createRuntime(backup, 'old');

      const result = await recoverInterruptedRuntime(f.root);

      expect(result.recovered).toBe(false);
      expect(result.reason).toBe('runtime-already-present');

      expect(
        await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')
      ).toBe('new');

      expect(
        await readFile(path.join(backup, 'rea', 'version.txt'), 'utf8')
      ).toBe('old');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('does not restore an incomplete backup', async () => {
    const f = await fixture();

    try {
      const backup = path.join(f.root, '.runtime-previous-active');

      await mkdir(path.join(backup, 'rea'), { recursive: true });

      await expect(
        recoverInterruptedRuntime(f.root)
      ).rejects.toThrow('Unexpected runtime components');

      await expect(
        readFile(path.join(backup, 'rea', 'version.txt'), 'utf8')
      ).rejects.toThrow();
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('does nothing when no backup exists', async () => {
    const f = await fixture();

    try {
      await f.createRuntime(f.active, 'current');

      const result = await recoverInterruptedRuntime(f.root);

      expect(result).toEqual({
        recovered: false,
        reason: 'no-backup'
      });

      expect(
        await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')
      ).toBe('current');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});

describe('publication rollback with existing diagnostics', () => {
  it('restores the previous runtime without overwriting existing diagnostics', async () => {
    const f = await fixture();

    try {
      await f.createRuntime(f.active, 'previous');
      await f.createRuntime(f.staged, 'new');

      const failed = path.join(f.root, '.runtime-failed-publish');

      await mkdir(failed, { recursive: true });
      await writeFile(
        path.join(failed, 'diagnostic.txt'),
        'preserve-existing-diagnostics'
      );

      await expect(
        publishRuntime({ target, validateCandidate: fixtureValidation,
          projectRoot: f.root,
          stagedRuntime: f.staged,
          onStep(step: string) {
            if (step === 'runtime-published') {
              throw new Error('Simulated post-publication failure');
            }
          }
        })
      ).rejects.toThrow();

      expect(
        await readFile(
          path.join(f.active, 'rea', 'version.txt'),
          'utf8'
        )
      ).toBe('previous');

      expect(
        await readFile(
          path.join(failed, 'diagnostic.txt'),
          'utf8'
        )
      ).toBe('preserve-existing-diagnostics');

      const entries = await readdir(f.root);

      const preservedNewRuntimes = entries.filter(
        (entry) => entry.startsWith('.runtime-failed-publish-')
      );

      expect(preservedNewRuntimes).toHaveLength(1);

      expect(
        await readFile(
          path.join(
            f.root,
            preservedNewRuntimes[0],
            'rea',
            'version.txt'
          ),
          'utf8'
        )
      ).toBe('new');

    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});

describe('rollback failure safety', () => {
  it('preserves both runtimes when diagnostic relocation fails', async () => {
    const f = await fixture();

    try {
      await f.createRuntime(f.active, 'previous');
      await f.createRuntime(f.staged, 'new');

      const diagnostic = path.join(
        f.root,
        '.runtime-failed-publish'
      );

      await writeFile(diagnostic, 'occupied-by-file');

      let capturedError: unknown;

      try {
        await publishRuntime({ target, validateCandidate: fixtureValidation,
          projectRoot: f.root,
          stagedRuntime: f.staged,
          onStep(step: string) {
            if (step === 'runtime-published') {
              throw new Error('Simulated post-publication failure');
            }
          }
        });
      } catch (error) {
        capturedError = error;
      }

      expect(capturedError).toBeInstanceOf(AggregateError);

      const aggregate = capturedError as AggregateError;

      expect(aggregate.message).toContain(
        'rollback is incomplete'
      );

      expect(aggregate.errors).toHaveLength(2);

      expect(aggregate.errors[0].message).toBe(
        'Simulated post-publication failure'
      );

      expect(aggregate.errors[1]).toBeInstanceOf(Error);

      expect(
        await readFile(
          path.join(f.active, 'rea', 'version.txt'),
          'utf8'
        )
      ).toBe('new');

      expect(
        await readFile(
          path.join(
            f.root,
            '.runtime-previous-active',
            'rea',
            'version.txt'
          ),
          'utf8'
        )
      ).toBe('previous');

      expect(
        await readFile(diagnostic, 'utf8')
      ).toBe('occupied-by-file');

    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});

describe('preserved runtime publication', () => {
  it('preserves the previous runtime after successful publication', async () => {
    const f = await fixture();

    try {
      await f.createRuntime(f.active, 'old');
      await f.createRuntime(f.staged, 'new');

      const result = await publishRuntime({ target, validateCandidate: fixtureValidation,
        projectRoot: f.root,
        stagedRuntime: f.staged,
        preservePreviousRuntime: true
      });

      expect(result.published).toBe(true);
      expect(result.cleanupPending).toBe(false);
      expect(result.previousRuntimePreserved).toBe(true);

      expect(
        await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')
      ).toBe('new');

      expect(
        await readFile(
          path.join(f.root, '.runtime-previous-active', 'rea', 'version.txt'),
          'utf8'
        )
      ).toBe('old');

      expect(
        await readFile(
          path.join(f.root, '.runtime-previous-active', 'node', 'version.txt'),
          'utf8'
        )
      ).toBe('old');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('blocks another publication while the preserved backup exists', async () => {
    const f = await fixture();

    try {
      await f.createRuntime(f.active, 'old');
      await f.createRuntime(f.staged, 'new');

      await publishRuntime({ target, validateCandidate: fixtureValidation,
        projectRoot: f.root,
        stagedRuntime: f.staged,
        preservePreviousRuntime: true
      });

      const second = path.join(
        f.root,
        '.runtime-build-second',
        'runtime'
      );

      await f.createRuntime(second, 'newer');

      await expect(
        publishRuntime({ target, validateCandidate: fixtureValidation,
          projectRoot: f.root,
          stagedRuntime: second,
          preservePreviousRuntime: true
        })
      ).rejects.toThrow('Previous runtime backup exists');

      expect(
        await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')
      ).toBe('new');

      expect(
        await readFile(
          path.join(f.root, '.runtime-previous-active', 'rea', 'version.txt'),
          'utf8'
        )
      ).toBe('old');

      expect(
        await readFile(path.join(second, 'rea', 'version.txt'), 'utf8')
      ).toBe('newer');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});

describe('runtime publication', () => {
  it('publishes a complete runtime and removes the previous backup', async () => {
    const f = await fixture();

    try {
      await f.createRuntime(f.active, 'old');
      await f.createRuntime(f.staged, 'new');

      const result = await publishRuntime({ target, validateCandidate: fixtureValidation,
        projectRoot: f.root,
        stagedRuntime: f.staged
      });

      expect(result.published).toBe(true);
      expect(result.cleanupPending).toBe(false);

      expect(
        await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')
      ).toBe('new');

      expect(
        await readFile(path.join(f.active, 'node', 'version.txt'), 'utf8')
      ).toBe('new');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('rejects an incomplete staged runtime without changing the active runtime', async () => {
    const f = await fixture();

    try {
      await f.createRuntime(f.active, 'old');
      await mkdir(path.join(f.staged, 'rea'), { recursive: true });

      await expect(
        publishRuntime({ target, validateCandidate: fixtureValidation,
          projectRoot: f.root,
          stagedRuntime: f.staged
        })
      ).rejects.toThrow('Unexpected runtime components');

      expect(
        await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')
      ).toBe('old');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('restores the previous runtime if publication fails after backup', async () => {
    const f = await fixture();

    try {
      await f.createRuntime(f.active, 'old');
      await f.createRuntime(f.staged, 'new');

      await expect(
        publishRuntime({ target, validateCandidate: fixtureValidation,
          projectRoot: f.root,
          stagedRuntime: f.staged,
          onStep(step: string) {
            if (step === 'backup-created') {
              throw new Error('Simulated publication failure');
            }
          }
        })
      ).rejects.toThrow('Simulated publication failure');

      expect(
        await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')
      ).toBe('old');

      expect(
        await readFile(path.join(f.active, 'node', 'version.txt'), 'utf8')
      ).toBe('old');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});


describe('publication source containment', () => {
  it('rejects a symbolic staging parent', async () => {
    const f = await fixture();
    const external = await mkdtemp(path.join(os.tmpdir(), 'rea-publish-external-'));
    try {
      await f.createRuntime(f.active, 'old');
      await f.createRuntime(path.join(external, 'runtime'), 'new');
      const link = path.join(f.root, '.runtime-build-linked');
      await symlink(external, link, 'dir');
      await expect(publishRuntime({ target, validateCandidate: fixtureValidation, projectRoot: f.root,
        stagedRuntime: path.join(link, 'runtime') })).rejects.toThrow('Expected a real directory');
      expect(await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')).toBe('old');
      expect(await readFile(path.join(external, 'runtime', 'rea', 'version.txt'), 'utf8')).toBe('new');
    } finally {
      await rm(f.root, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });
});

describe('publication integrity contract under the lock', () => {
  it.each([undefined, '', 'linux-arm64', '../darwin-arm64', 'DARWIN-ARM64'])('requires an explicit supported target: %j', async invalidTarget => {
    const f = await fixture();
    const validateCandidate = vi.fn();
    try {
      await f.createRuntime(f.active, 'old');
      await f.createRuntime(f.staged, 'new');
      await expect(publishRuntime({ projectRoot: f.root, stagedRuntime: f.staged,
        target: invalidTarget, validateCandidate })).rejects.toThrow('explicit supported');
      expect(validateCandidate).not.toHaveBeenCalled();
      expect(await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')).toBe('old');
      expect(await readFile(path.join(f.staged, 'rea', 'version.txt'), 'utf8')).toBe('new');
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('validates source and published paths under the same lock before preserving the backup', async () => {
    const f = await fixture();
    const sequence: string[] = [];
    try {
      await f.createRuntime(f.active, 'old');
      await f.createRuntime(f.staged, 'new');
      const validateCandidate = vi.fn(async (directory: string, receivedTarget: string) => {
        expect(receivedTarget).toBe(target);
        expect((await lstat(path.join(f.root, '.runtime-publish-lock'))).isDirectory()).toBe(true);
        expect(await readFile(path.join(directory, 'rea', 'version.txt'), 'utf8')).toBe('new');
        if (directory === f.staged) {
          expect(await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')).toBe('old');
          await expect(lstat(path.join(f.root, '.runtime-previous-active'))).rejects.toThrow();
        } else {
          expect(directory).toBe(f.active);
          expect(await readFile(path.join(f.root, '.runtime-previous-active', 'rea', 'version.txt'), 'utf8')).toBe('old');
        }
        sequence.push(directory === f.staged ? 'source-validated' : 'published-validated');
      });
      const result = await publishRuntime({ projectRoot: f.root, stagedRuntime: f.staged,
        target, validateCandidate, preservePreviousRuntime: true,
        onStep: (step: string) => sequence.push(step) });
      expect(result.previousRuntimePreserved).toBe(true);
      expect(validateCandidate).toHaveBeenCalledTimes(2);
      expect(sequence).toEqual(['source-validated', 'backup-created', 'runtime-published', 'published-validated', 'runtime-validated']);
      await expect(lstat(path.join(f.root, '.runtime-publish-lock'))).rejects.toThrow();
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('blocks concurrent publication throughout asynchronous validation', async () => {
    const f = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let pending: Promise<unknown> | undefined;
    try {
      await f.createRuntime(f.active, 'old');
      await f.createRuntime(f.staged, 'new');
      const second = path.join(f.root, '.runtime-build-second', 'runtime');
      await f.createRuntime(second, 'second');
      const validateCandidate = vi.fn(async () => { entered(); await gate; });
      pending = publishRuntime({ projectRoot: f.root, stagedRuntime: f.staged,
        target, validateCandidate, preservePreviousRuntime: true });
      await started;
      const competingValidator = vi.fn();
      await expect(publishRuntime({ projectRoot: f.root, stagedRuntime: second,
        target, validateCandidate: competingValidator })).rejects.toThrow('already in progress');
      expect(competingValidator).not.toHaveBeenCalled();
      expect(await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')).toBe('old');
      expect(await readFile(path.join(second, 'rea', 'version.txt'), 'utf8')).toBe('second');
      release(); await pending;
    } finally { release(); await pending; await rm(f.root, { recursive: true, force: true }); }
  });

  it('preserves even an empty existing diagnostics directory after validation failure', async () => {
    const f = await fixture();
    try {
      await f.createRuntime(f.active, 'old');
      await f.createRuntime(f.staged, 'new');
      const failed = path.join(f.root, '.runtime-failed-publish');
      await mkdir(failed);
      const original = await lstat(failed);
      const validateCandidate = vi.fn().mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Post-publication integrity failure'));
      await expect(publishRuntime({ projectRoot: f.root, stagedRuntime: f.staged,
        target, validateCandidate })).rejects.toThrow('Post-publication integrity failure');
      expect(await readdir(failed)).toEqual([]);
      expect((await lstat(failed)).ino).toBe(original.ino);
      expect(await readFile(path.join(f.active, 'rea', 'version.txt'), 'utf8')).toBe('old');
      const diagnostics = (await readdir(f.root)).filter(entry => entry.startsWith('.runtime-failed-publish-'));
      expect(diagnostics).toHaveLength(1);
      expect(await readFile(path.join(f.root, diagnostics[0], 'rea', 'version.txt'), 'utf8')).toBe('new');
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
