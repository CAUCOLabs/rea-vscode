import { lstat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function inspectProcess(pid) {
  try {
    process.kill(pid, 0);
    return 'exists';
  } catch (error) {
    if (error.code === 'ESRCH') return 'not-found';
    if (error.code === 'EPERM') return 'exists';
    return 'unknown';
  }
}

export async function inspectRuntimeLock(projectRoot) {
  const root = path.resolve(projectRoot);
  const lockDirectory = path.join(root, '.runtime-publish-lock');
  const ownerFile = path.join(lockDirectory, 'owner.json');

  let lockInfo;

  try {
    lockInfo = await lstat(lockDirectory);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { status: 'unlocked' };
    }

    throw error;
  }

  if (!lockInfo.isDirectory() || lockInfo.isSymbolicLink()) {
    return {
      status: 'unknown',
      reason: 'invalid-lock-directory'
    };
  }

  let owner;

  try {
    owner = JSON.parse(await readFile(ownerFile, 'utf8'));
  } catch {
    return {
      status: 'unknown',
      reason: 'missing-or-invalid-owner-metadata'
    };
  }

  if (
    owner.schemaVersion !== 1 ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    typeof owner.hostname !== 'string' ||
    typeof owner.operationId !== 'string' ||
    typeof owner.acquiredAt !== 'string'
  ) {
    return {
      status: 'unknown',
      reason: 'invalid-owner-metadata'
    };
  }

  if (owner.hostname !== os.hostname()) {
    return {
      status: 'unknown',
      reason: 'different-host',
      owner
    };
  }

  const processState = inspectProcess(owner.pid);

  if (processState === 'not-found') {
    return {
      status: 'stale-candidate',
      reason: 'owner-pid-not-found',
      owner
    };
  }

  if (processState === 'exists') {
    return {
      status: 'active',
      reason: 'owner-pid-exists',
      owner
    };
  }

  return {
    status: 'unknown',
    reason: 'process-state-undetermined',
    owner
  };
}
