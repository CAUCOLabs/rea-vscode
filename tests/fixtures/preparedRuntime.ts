import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function createValidStagedRuntime(staged: string, target: string) {
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

