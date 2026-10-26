import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validatePreparedRuntime } from '../scripts/validate-runtime.mjs';

const target = `${process.platform}-${process.arch}`;

const manifestPath = path.join(
  process.cwd(),
  'patches',
  'rea-6.7.0',
  'manifest.json'
);

const manifestHash = createHash('sha256')
  .update(await readFile(manifestPath))
  .digest('hex');

async function fixture() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'rea-integrity-test-')
  );

  const rea = path.join(root, 'rea');
  const node = path.join(root, 'node', target);

  await mkdir(rea, { recursive: true });
  await mkdir(node, { recursive: true });

  const filename = 'engine.txt';
  const contents = 'REA test engine';

  await writeFile(path.join(rea, filename), contents);

  const hash = createHash('sha256')
    .update(contents)
    .digest('hex');

  const reaMetadata = {
    version: '6.7.0',
    platform: process.platform,
    arch: process.arch,
    patches: [{
      id: 'rea-6.7.0/native-executable-verification',
      manifestSha256: manifestHash
    }],
    files: {
      [filename]: hash
    }
  };

  await writeFile(
    path.join(rea, 'distribution.json'),
    JSON.stringify(reaMetadata)
  );

  const executable = path.join(
    node,
    process.platform === 'win32' ? 'node.exe' : 'bin/node'
  );

  await mkdir(path.dirname(executable), { recursive: true });
  await copyFile(process.execPath, executable);

  const nodeVersion = process.env.NODE_RUNTIME_VERSION || '26.8.1';
  const archiveTarget = target === 'win32-x64' ? 'win-x64' : target;
  const archiveExtension =
    process.platform === 'win32' ? 'zip' :
    process.platform === 'linux' ? 'tar.xz' : 'tar.gz';

  const nodeMetadata = {
    version: nodeVersion,
    target,
    archive: `node-v${nodeVersion}-${archiveTarget}.${archiveExtension}`,
    sha256: 'b'.repeat(64),
    executableSha256: createHash('sha256')
      .update(await readFile(executable))
      .digest('hex')
  };

  await writeFile(
    path.join(node, 'distribution.json'),
    JSON.stringify(nodeMetadata)
  );

  return { root, rea, node, reaMetadata, nodeMetadata };
}

describe('prepared runtime integrity', () => {
  it('accepts a valid prepared runtime', async () => {
    const f = await fixture();

    try {
      const result = await validatePreparedRuntime(f.root, target);

      expect(result.valid).toBe(true);
      expect(result.verifiedReaFiles).toBe(1);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('rejects incorrect REA patch provenance', async () => {
    const f = await fixture();

    try {
      const metadata = {
        ...f.reaMetadata,
        patches: [{
          id: 'rea-6.7.0/native-executable-verification',
          manifestSha256: 'a'.repeat(64)
        }]
      };

      await writeFile(
        path.join(f.rea, 'distribution.json'),
        JSON.stringify(metadata)
      );

      await expect(
        validatePreparedRuntime(f.root, target)
      ).rejects.toThrow('Required REA patch provenance missing');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it.each([
    ['incorrect version', { version: '0.0.0' }, 'Unexpected Node version'],
    ['incorrect archive', { archive: 'incorrect.tar.gz' }, 'Node archive metadata mismatch'],
    ['invalid archive hash', { sha256: 'invalid' }, 'Invalid Node archive SHA-256']
  ])('rejects Node metadata: %s', async (_name, changes, expectedError) => {
    const f = await fixture();

    try {
      await writeFile(
        path.join(f.node, 'distribution.json'),
        JSON.stringify({ ...f.nodeMetadata, ...changes })
      );

      await expect(
        validatePreparedRuntime(f.root, target)
      ).rejects.toThrow(expectedError);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'incorrect executable hash',
      { executableSha256: 'a'.repeat(64) },
      'Node executable integrity mismatch'
    ],
    [
      'missing executable hash',
      { executableSha256: undefined },
      'Invalid Node executable SHA-256'
    ]
  ])('rejects Node executable metadata: %s', async (
    _name,
    changes,
    expectedError
  ) => {
    const f = await fixture();

    try {
      await writeFile(
        path.join(f.node, 'distribution.json'),
        JSON.stringify({ ...f.nodeMetadata, ...changes })
      );

      await expect(
        validatePreparedRuntime(f.root, target)
      ).rejects.toThrow(expectedError);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('rejects a physically modified Node executable', async () => {
    const f = await fixture();

    try {
      const executable = path.join(
        f.node,
        process.platform === 'win32' ? 'node.exe' : 'bin/node'
      );

      const original = await readFile(executable);
      const modified = Buffer.from(original);

      modified[modified.length - 1] ^= 0x01;

      await writeFile(executable, modified);

      await expect(
        validatePreparedRuntime(f.root, target)
      ).rejects.toThrow('Node executable integrity mismatch');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('rejects a modified REA file', async () => {
    const f = await fixture();

    try {
      await writeFile(path.join(f.rea, 'engine.txt'), 'modified');

      await expect(
        validatePreparedRuntime(f.root, target)
      ).rejects.toThrow('REA integrity mismatch');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('rejects an unexpected REA file', async () => {
    const f = await fixture();

    try {
      await writeFile(path.join(f.rea, 'unexpected.txt'), 'extra');

      await expect(
        validatePreparedRuntime(f.root, target)
      ).rejects.toThrow('REA inventory does not match runtime contents');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('rejects a missing REA file', async () => {
    const f = await fixture();

    try {
      await unlink(path.join(f.rea, 'engine.txt'));

      await expect(
        validatePreparedRuntime(f.root, target)
      ).rejects.toThrow();
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('rejects a symbolic link inside REA', async () => {
    const f = await fixture();

    try {
      await symlink(
        path.join(f.rea, 'engine.txt'),
        path.join(f.rea, 'linked.txt')
      );

      await expect(
        validatePreparedRuntime(f.root, target)
      ).rejects.toThrow('Symbolic link in REA runtime');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('rejects incompatible REA platform metadata', async () => {
    const f = await fixture();

    try {
      const metadata = {
        ...f.reaMetadata,
        platform: 'invalid-platform'
      };

      await writeFile(
        path.join(f.rea, 'distribution.json'),
        JSON.stringify(metadata)
      );

      await expect(
        validatePreparedRuntime(f.root, target)
      ).rejects.toThrow('REA platform mismatch');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});


it('rejects altered security dependency provenance', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.rea, 'distribution.json'), JSON.stringify({
      ...f.reaMetadata, securityDependencies: { 'fast-uri': '3.1.8', zod: '4.4.3', ajv: '8.20.0' }
    }));
    await expect(validatePreparedRuntime(f.root, target)).rejects.toThrow('Unexpected runtime security dependency metadata');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
