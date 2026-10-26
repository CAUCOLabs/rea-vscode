import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  rename,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
  readdir
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { saveRuntimeCandidate } from '../scripts/save-runtime-candidate.mjs';
import { validatePreparedRuntime } from '../scripts/validate-runtime.mjs';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

vi.mock('../scripts/validate-runtime.mjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scripts/validate-runtime.mjs')>();
  return { ...actual, validatePreparedRuntime: vi.fn(actual.validatePreparedRuntime) };
});

async function createValidStagedRuntime(staged: string, target: string) {
  const rea = path.join(staged, 'rea');
  const node = path.join(staged, 'node', target);

  await mkdir(rea, { recursive: true });
  await mkdir(node, { recursive: true });

  const contents = 'REA candidate test engine';

  await writeFile(
    path.join(rea, 'engine.txt'),
    contents
  );

  const sha256 = (data: string | Buffer) =>
    createHash('sha256').update(data).digest('hex');

  const manifest = await readFile(
    path.join(
      process.cwd(),
      'patches',
      'rea-6.7.0',
      'manifest.json'
    )
  );

  await writeFile(
    path.join(rea, 'distribution.json'),
    JSON.stringify({
      version: '6.7.0',
      platform: process.platform,
      arch: process.arch,
      patches: [{
        id: 'rea-6.7.0/native-executable-verification',
        manifestSha256: sha256(manifest)
      }],
      files: {
        'engine.txt': sha256(contents)
      }
    })
  );

  const executable = path.join(
    node,
    process.platform === 'win32' ? 'node.exe' : 'bin/node'
  );

  await mkdir(path.dirname(executable), { recursive: true });
  await copyFile(process.execPath, executable);

  const nodeVersion = process.env.NODE_RUNTIME_VERSION || '26.8.1';
  const archiveTarget = target === 'win32-x64' ? 'win-x64' : target;

  const extension =
    process.platform === 'win32' ? 'zip' :
    process.platform === 'linux' ? 'tar.xz' : 'tar.gz';

  await writeFile(
    path.join(node, 'distribution.json'),
    JSON.stringify({
      version: nodeVersion,
      target,
      archive: `node-v${nodeVersion}-${archiveTarget}.${extension}`,
      sha256: 'b'.repeat(64),
      executableSha256: sha256(await readFile(executable))
    })
  );
}

describe('runtime candidate safety', () => {
  it('rejects a runtime outside the project', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'rea-candidate-project-')
    );

    const external = await mkdtemp(
      path.join(os.tmpdir(), 'rea-candidate-external-')
    );

    try {
      const staged = path.join(external, 'runtime');
      await mkdir(staged);

      await expect(
        saveRuntimeCandidate({
          projectRoot: root,
          stagedRuntime: staged,
          target: `${process.platform}-${process.arch}`
        })
      ).rejects.toThrow('Invalid staged runtime location');

    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });

  it('rejects an incorrectly named staging directory', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'rea-candidate-project-')
    );

    try {
      const staged = path.join(root, 'incorrect-staging', 'runtime');

      await mkdir(staged, { recursive: true });

      await expect(
        saveRuntimeCandidate({
          projectRoot: root,
          stagedRuntime: staged,
          target: `${process.platform}-${process.arch}`
        })
      ).rejects.toThrow('Invalid staged runtime location');

    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an incorrectly nested runtime', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'rea-candidate-project-')
    );

    try {
      const staged = path.join(
        root,
        '.runtime-build-test',
        'nested',
        'runtime'
      );

      await mkdir(staged, { recursive: true });

      await expect(
        saveRuntimeCandidate({
          projectRoot: root,
          stagedRuntime: staged,
          target: `${process.platform}-${process.arch}`
        })
      ).rejects.toThrow('Invalid staged runtime location');

    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects invalid metadata without replacing the active runtime', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'rea-candidate-project-')
    );

    try {
      const active = path.join(root, 'runtime');
      const staged = path.join(
        root,
        '.runtime-build-test',
        'runtime'
      );

      await mkdir(path.join(active, 'rea'), { recursive: true });
      await mkdir(path.join(active, 'node'), { recursive: true });

      await writeFile(
        path.join(active, 'rea', 'version.txt'),
        'existing-runtime'
      );

      await mkdir(path.join(staged, 'rea'), { recursive: true });

      await mkdir(
        path.join(staged, 'node', `${process.platform}-${process.arch}`),
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
        saveRuntimeCandidate({
          projectRoot: root,
          stagedRuntime: staged,
          target: `${process.platform}-${process.arch}`
        })
      ).rejects.toThrow('Unexpected REA version');

      expect(
        await readFile(
          path.join(active, 'rea', 'version.txt'),
          'utf8'
        )
      ).toBe('existing-runtime');

      expect(
        await readFile(
          path.join(staged, 'rea', 'distribution.json'),
          'utf8'
        )
      ).toContain('0.0.0');

    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });


  it('saves a valid candidate without modifying the active runtime', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'rea-candidate-project-')
    );

    const target = `${process.platform}-${process.arch}`;

    try {
      const active = path.join(root, 'runtime');
      const staged = path.join(
        root,
        '.runtime-build-test',
        'runtime'
      );

      await mkdir(path.join(active, 'rea'), { recursive: true });

      await writeFile(
        path.join(active, 'rea', 'version.txt'),
        'existing-runtime'
      );

      await createValidStagedRuntime(staged, target);

      const result = await saveRuntimeCandidate({
        projectRoot: root,
        stagedRuntime: staged,
        target
      });

      expect(result.saved).toBe(true);
      expect(result.verifiedReaFiles).toBe(1);

      expect(
        result.candidatePath.startsWith(
          path.join(root, '.runtime-candidates') + path.sep
        )
      ).toBe(true);

      expect(
        await readFile(
          path.join(active, 'rea', 'version.txt'),
          'utf8'
        )
      ).toBe('existing-runtime');

      await expect(stat(staged)).rejects.toThrow();

      const validation = await validatePreparedRuntime(
        result.candidatePath,
        target
      );

      expect(validation.valid).toBe(true);
      expect(validation.verifiedReaFiles).toBe(1);

    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });


  it('saves two independent candidates without overwriting either', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'rea-candidate-project-')
    );

    const target = `${process.platform}-${process.arch}`;

    try {
      const active = path.join(root, 'runtime');

      await mkdir(path.join(active, 'rea'), { recursive: true });

      await writeFile(
        path.join(active, 'rea', 'version.txt'),
        'existing-runtime'
      );

      const firstStaged = path.join(
        root,
        '.runtime-build-first',
        'runtime'
      );

      const secondStaged = path.join(
        root,
        '.runtime-build-second',
        'runtime'
      );

      await createValidStagedRuntime(firstStaged, target);
      await createValidStagedRuntime(secondStaged, target);

      const first = await saveRuntimeCandidate({
        projectRoot: root,
        stagedRuntime: firstStaged,
        target
      });

      const second = await saveRuntimeCandidate({
        projectRoot: root,
        stagedRuntime: secondStaged,
        target
      });

      expect(first.saved).toBe(true);
      expect(second.saved).toBe(true);

      expect(first.candidateId).not.toBe(second.candidateId);
      expect(first.candidatePath).not.toBe(second.candidatePath);

      expect(
        await readFile(
          path.join(first.candidatePath, 'rea', 'engine.txt'),
          'utf8'
        )
      ).toBe('REA candidate test engine');

      expect(
        await readFile(
          path.join(second.candidatePath, 'rea', 'engine.txt'),
          'utf8'
        )
      ).toBe('REA candidate test engine');

      const firstValidation = await validatePreparedRuntime(
        first.candidatePath,
        target
      );

      const secondValidation = await validatePreparedRuntime(
        second.candidatePath,
        target
      );

      expect(firstValidation.valid).toBe(true);
      expect(secondValidation.valid).toBe(true);

      await expect(stat(firstStaged)).rejects.toThrow();
      await expect(stat(secondStaged)).rejects.toThrow();

      expect(
        await readFile(
          path.join(active, 'rea', 'version.txt'),
          'utf8'
        )
      ).toBe('existing-runtime');

    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });


  it('never overwrites an existing candidate ID', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'rea-candidate-project-')
    );

    const target = `${process.platform}-${process.arch}`;
    const candidateId = `${target}-fixed-collision`;

    try {
      const staged = path.join(
        root,
        '.runtime-build-collision',
        'runtime'
      );

      await createValidStagedRuntime(staged, target);

      const existing = path.join(
        root,
        '.runtime-candidates',
        candidateId
      );

      await mkdir(existing, { recursive: true });

      await expect(
        saveRuntimeCandidate({
          projectRoot: root,
          stagedRuntime: staged,
          target,
          createCandidateId: () => 'fixed-collision'
        })
      ).rejects.toThrow();

      expect(await readdir(existing)).toEqual([]);

      const validation = await validatePreparedRuntime(
        staged,
        target
      );

      expect(validation.valid).toBe(true);

    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['../escape', 'x/../../escape', '..\\escape', '/absolute', '', 'a:b']) (
    'rejects unsafe candidate identifier %j without moving staging', async (identifier) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'rea-candidate-id-'));
      const staged = path.join(root, '.runtime-build-test', 'runtime');
      const target = `${process.platform}-${process.arch}`;
      try {
        await createValidStagedRuntime(staged, target);
        await expect(saveRuntimeCandidate({
          projectRoot: root, stagedRuntime: staged, target,
          createCandidateId: () => identifier
        })).rejects.toThrow('Invalid candidate identifier');
        expect((await validatePreparedRuntime(staged, target)).valid).toBe(true);
        await expect(stat(path.join(root, '.runtime-candidates'))).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it('reserves a colliding ID exclusively across concurrent saves', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rea-candidate-race-'));
    const target = `${process.platform}-${process.arch}`;
    const sources = ['first', 'second'].map(name =>
      path.join(root, `.runtime-build-${name}`, 'runtime'));
    try {
      await Promise.all(sources.map(source => createValidStagedRuntime(source, target)));
      const results = await Promise.allSettled(sources.map(stagedRuntime =>
        saveRuntimeCandidate({ projectRoot: root, stagedRuntime, target,
          createCandidateId: () => 'collision' })));
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const loser = results.findIndex(result => result.status === 'rejected');
      expect((await validatePreparedRuntime(sources[loser], target)).valid).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves staging and removes only its empty reservation when a move fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rea-candidate-move-'));
    const target = `${process.platform}-${process.arch}`;
    const staged = path.join(root, '.runtime-build-test', 'runtime');
    try {
      await createValidStagedRuntime(staged, target);
      vi.mocked(rename).mockRejectedValueOnce(new Error('Move failed'));
      await expect(saveRuntimeCandidate({ projectRoot: root, stagedRuntime: staged,
        target, createCandidateId: () => 'failed' })).rejects.toThrow('Move failed');
      expect((await validatePreparedRuntime(staged, target)).valid).toBe(true);
      expect(await readdir(path.join(root, '.runtime-candidates'))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains a moved runtime for recovery when placement validation fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rea-candidate-validation-'));
    const target = `${process.platform}-${process.arch}`;
    const staged = path.join(root, '.runtime-build-test', 'runtime');
    try {
      await createValidStagedRuntime(staged, target);
      const validation = await validatePreparedRuntime(staged, target);
      vi.mocked(validatePreparedRuntime).mockResolvedValueOnce(validation)
        .mockRejectedValueOnce(new Error('Post-placement failure'));
      const saved = path.join(root, '.runtime-candidates', `${target}-failed`, 'runtime');
      await expect(saveRuntimeCandidate({ projectRoot: root, stagedRuntime: staged,
        target, createCandidateId: () => 'failed' })).rejects.toThrow(saved);
      expect((await validatePreparedRuntime(saved, target)).valid).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a symbolic Node parent before executing Node', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rea-candidate-node-link-'));
    const target = `${process.platform}-${process.arch}`;
    const staged = path.join(root, '.runtime-build-test', 'runtime');
    try {
      await createValidStagedRuntime(staged, target);
      const external = path.join(root, 'external-node');
      await rename(path.join(staged, 'node'), external);
      await symlink(external, path.join(staged, 'node'), 'dir');
      await expect(saveRuntimeCandidate({ projectRoot: root,
        stagedRuntime: staged, target })).rejects.toThrow('Expected a real directory');
      expect(await readdir(external)).toEqual([target]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a symbolic candidate destination', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'rea-candidate-project-')
    );
    const external = await mkdtemp(
      path.join(os.tmpdir(), 'rea-external-candidates-')
    );
    const target = `${process.platform}-${process.arch}`;

    try {
      const active = path.join(root, 'runtime');
      await mkdir(active, { recursive: true });
      await writeFile(
        path.join(active, 'sentinel.txt'),
        'active-runtime'
      );

      const staged = path.join(
        root,
        '.runtime-build-test',
        'runtime'
      );

      await createValidStagedRuntime(staged, target);

      await symlink(
        external,
        path.join(root, '.runtime-candidates'),
        'dir'
      );

      await expect(
        saveRuntimeCandidate({
          projectRoot: root,
          stagedRuntime: staged,
          target
        })
      ).rejects.toThrow('Invalid candidate destination');

      expect(
        await readFile(
          path.join(active, 'sentinel.txt'),
          'utf8'
        )
      ).toBe('active-runtime');

      const validation = await validatePreparedRuntime(
        staged,
        target
      );

      expect(validation.valid).toBe(true);
      expect(await readdir(external)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });

  it('rejects a symbolic staging directory', async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'rea-candidate-project-')
    );

    const external = await mkdtemp(
      path.join(os.tmpdir(), 'rea-external-runtime-')
    );

    const target = `${process.platform}-${process.arch}`;

    try {
      const externalRuntime = path.join(external, 'runtime');

      await createValidStagedRuntime(externalRuntime, target);

      const stagingLink = path.join(
        root,
        '.runtime-build-linked'
      );

      await symlink(external, stagingLink, 'dir');

      await expect(
        saveRuntimeCandidate({
          projectRoot: root,
          stagedRuntime: path.join(stagingLink, 'runtime'),
          target
        })
      ).rejects.toThrow('Invalid staged runtime location');

      const validation = await validatePreparedRuntime(
        externalRuntime,
        target
      );

      expect(validation.valid).toBe(true);

    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });

});
