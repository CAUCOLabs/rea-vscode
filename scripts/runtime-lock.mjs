import { mkdir, rmdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export async function withRuntimePublicationLock(projectRoot, operation) {
  const root = path.resolve(projectRoot);
  const lockDirectory = path.join(root, '.runtime-publish-lock');
  const ownerFile = path.join(lockDirectory, 'owner.json');

  try {
    await mkdir(lockDirectory);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(
        `Runtime publication already in progress or lock requires recovery: ${lockDirectory}`
      );
    }

    throw error;
  }

  const owner = {
    schemaVersion: 1,
    operationId: randomUUID(),
    pid: process.pid,
    ppid: process.ppid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString()
  };

  let metadataWritten = false;

  try {
    await writeFile(
      ownerFile,
      JSON.stringify(owner, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 }
    );

    metadataWritten = true;

    return await operation();
  } finally {
    if (metadataWritten) {
      await unlink(ownerFile);
    }

    await rmdir(lockDirectory);
  }
}
