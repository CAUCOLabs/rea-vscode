import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReaSecurityDependencies, securityVersions } from './rea-security-dependencies.mjs';

async function realFile(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Expected a regular file: ${filename}`);
  }
}

async function realDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Expected a real directory: ${directory}`);
  }
}

function safeRelativePath(filename) {
  return (
    typeof filename === 'string' &&
    filename.length > 0 &&
    !path.isAbsolute(filename) &&
    !filename.split('/').some(part =>
      part === '' || part === '.' || part === '..'
    ) &&
    !filename.includes('\\')
  );
}

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

async function expectedPatchManifestHash() {
  const manifest = path.join(
    projectRoot,
    'patches',
    'rea-6.7.0',
    'manifest.json'
  );

  return createHash('sha256')
    .update(await readFile(manifest))
    .digest('hex');
}

export async function validatePreparedRuntime(runtimeRoot, target) {
  if (typeof target !== 'string' || !/^[a-z0-9]+-[a-z0-9]+$/.test(target)) {
    throw new Error('Invalid runtime target');
  }
  const root = path.resolve(runtimeRoot);
  const rea = path.join(root, 'rea');
  const node = path.join(root, 'node', target);

  await realDirectory(root);
  await realDirectory(rea);
  await realDirectory(path.join(root, 'node'));
  await realDirectory(node);
  await realFile(path.join(rea, 'distribution.json'));

  const reaMetadata = JSON.parse(
    await readFile(path.join(rea, 'distribution.json'), 'utf8')
  );

  if (reaMetadata.version !== '6.7.0') {
    throw new Error('Unexpected REA version');
  }

  const [platform, arch] = target.split('-');

  if (
    reaMetadata.platform !== platform ||
    reaMetadata.arch !== arch
  ) {
    throw new Error('REA platform mismatch');
  }

  const expectedManifestHash = await expectedPatchManifestHash();

  if (
    !Array.isArray(reaMetadata.patches) ||
    !reaMetadata.patches.some(
      patch =>
        patch.id === 'rea-6.7.0/native-executable-verification' &&
        patch.manifestSha256 === expectedManifestHash
    )
  ) {
    throw new Error('Required REA patch provenance missing');
  }

  const inventory = reaMetadata.files;

  if (
    !inventory ||
    typeof inventory !== 'object' ||
    Array.isArray(inventory) ||
    Object.keys(inventory).length === 0
  ) {
    throw new Error('REA inventory missing');
  }

  for (const [relative, expectedHash] of Object.entries(inventory)) {
    if (
      !safeRelativePath(relative) ||
      !/^[a-f0-9]{64}$/.test(expectedHash)
    ) {
      throw new Error(`Invalid inventory entry: ${relative}`);
    }

    const filename = path.join(rea, relative);
    await realFile(filename);

    const actualHash = createHash('sha256')
      .update(await readFile(filename))
      .digest('hex');

    if (actualHash !== expectedHash) {
      throw new Error(`REA integrity mismatch: ${relative}`);
    }
  }

  // Reject unexpected files and symbolic links, including in nested paths.
  const actualFiles = new Set();

  async function inspectTree(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const relative = path.relative(rea, filename).split(path.sep).join('/');

      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic link in REA runtime: ${relative}`);
      }

      if (entry.isDirectory()) {
        await inspectTree(filename);
      } else if (entry.isFile()) {
        if (relative !== 'distribution.json') {
          actualFiles.add(relative);
        }
      } else {
        throw new Error(`Unsupported REA filesystem entry: ${relative}`);
      }
    }
  }

  await inspectTree(rea);

  const expectedFiles = new Set(Object.keys(inventory));

  if (
    actualFiles.size !== expectedFiles.size ||
    [...actualFiles].some(filename => !expectedFiles.has(filename))
  ) {
    throw new Error('REA inventory does not match runtime contents');
  }

  // Older protected baselines remain verifiable. Newly remediated packages
  // carry an inventoried manifest marker and matching distribution metadata.
  const packageMetadata = Object.hasOwn(inventory, 'package.json')
    ? JSON.parse(await readFile(path.join(rea, 'package.json'), 'utf8')) : {};
  if (packageMetadata.reaVscodeDependencyPolicy !== undefined || reaMetadata.securityDependencies !== undefined) {
    if (JSON.stringify(reaMetadata.securityDependencies) !== JSON.stringify(securityVersions)) {
      throw new Error('Unexpected runtime security dependency metadata');
    }
    await verifyReaSecurityDependencies(rea);
  }

  await realFile(path.join(node, 'distribution.json'));
  const nodeMetadata = JSON.parse(
    await readFile(path.join(node, 'distribution.json'), 'utf8')
  );

  if (nodeMetadata.target !== target) {
    throw new Error('Node target mismatch');
  }

  const expectedNodeVersion = process.env.NODE_RUNTIME_VERSION || '26.8.1';

  if (nodeMetadata.version !== expectedNodeVersion) {
    throw new Error('Unexpected Node version');
  }

  const archiveTarget = target === 'win32-x64' ? 'win-x64' : target;
  const archiveExtension =
    platform === 'win32' ? 'zip' :
    platform === 'linux' ? 'tar.xz' : 'tar.gz';

  const expectedArchive =
    `node-v${expectedNodeVersion}-${archiveTarget}.${archiveExtension}`;

  if (nodeMetadata.archive !== expectedArchive) {
    throw new Error('Node archive metadata mismatch');
  }

  if (
    typeof nodeMetadata.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(nodeMetadata.sha256)
  ) {
    throw new Error('Invalid Node archive SHA-256');
  }

  const executable = path.join(
    node,
    platform === 'win32' ? 'node.exe' : 'bin/node'
  );

  if (platform !== 'win32') await realDirectory(path.join(node, 'bin'));
  await realFile(executable);

  if (
    typeof nodeMetadata.executableSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(nodeMetadata.executableSha256)
  ) {
    throw new Error('Invalid Node executable SHA-256');
  }

  const actualExecutableHash = createHash('sha256')
    .update(await readFile(executable))
    .digest('hex');

  if (actualExecutableHash !== nodeMetadata.executableSha256) {
    throw new Error('Node executable integrity mismatch');
  }

  const reportedVersion = execFileSync(
    executable,
    ['-p', 'process.version'],
    { encoding: 'utf8' }
  ).trim();

  if (reportedVersion !== `v${nodeMetadata.version}`) {
    throw new Error('Node executable version mismatch');
  }

  return {
    valid: true,
    target,
    reaVersion: reaMetadata.version,
    nodeVersion: nodeMetadata.version,
    verifiedReaFiles: Object.keys(inventory).length
  };
}
