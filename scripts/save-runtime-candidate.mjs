import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rmdir } from 'node:fs/promises';
import path from 'node:path';

import { validatePreparedRuntime } from './validate-runtime.mjs';

export async function saveRuntimeCandidate({
  projectRoot,
  stagedRuntime,
  target,
  createCandidateId = randomUUID
}) {
  const root = path.resolve(projectRoot);
  const source = path.resolve(stagedRuntime);

  const stagingDirectory = path.dirname(source);
  const stagingName = path.basename(stagingDirectory);

  if (
    path.dirname(stagingDirectory) !== root ||
    !/^\.runtime-build-[A-Za-z0-9_-]+$/.test(stagingName) ||
    path.basename(source) !== 'runtime'
  ) {
    throw new Error('Invalid staged runtime location');
  }

  // Reject symbolic links before validating or moving the runtime.
  // A lexical path check alone cannot prevent staging outside the project.
  for (const directory of [root, stagingDirectory, source]) {
    const info = await lstat(directory);

    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Invalid staged runtime location');
    }
  }

  // Restrict both inputs before using them as filesystem path components.
  const identifier = createCandidateId();
  if (
    typeof target !== 'string' || !/^[a-z0-9]+-[a-z0-9]+$/.test(target) ||
    typeof identifier !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(identifier)
  ) {
    throw new Error('Invalid candidate identifier or target');
  }

  const validation = await validatePreparedRuntime(source, target);

  const candidatesRoot = path.join(root, '.runtime-candidates');

  await mkdir(candidatesRoot, { recursive: true });

  // Never follow a symbolic link for the candidate destination.
  const destinationInfo = await lstat(candidatesRoot);

  if (
    !destinationInfo.isDirectory() ||
    destinationInfo.isSymbolicLink()
  ) {
    throw new Error('Invalid candidate destination');
  }

  const candidateId = `${target}-${identifier}`;
  const reservation = path.join(candidatesRoot, candidateId);
  const candidatePath = path.join(reservation, 'runtime');

  // mkdir without recursive is an exclusive reservation on all supported OSes.
  // Never rename onto the reservation itself: POSIX rename can replace an
  // existing empty directory. Only this operation owns its initially empty child.
  await mkdir(reservation, { mode: 0o700 });

  try {
    await rename(source, candidatePath);
  } catch (error) {
    // Remove only our empty reservation, never recursively remove candidate data.
    try {
      await rmdir(reservation);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Candidate move failed; inspect staging at ${source} and reservation at ${reservation}`
      );
    }
    throw error;
  }

  try {
    await validatePreparedRuntime(candidatePath, target);
  } catch (error) {
    // Do not rename back onto source: another operation may have recreated it.
    // Retain the entire moved tree for manual recovery, even if it is invalid.
    throw new Error(
      `Candidate validation failed; runtime preserved for recovery at ${candidatePath}`,
      { cause: error }
    );
  }

  return {
    saved: true,
    candidateId,
    candidatePath,
    target,
    verifiedReaFiles: validation.verifiedReaFiles,
    nodeVersion: validation.nodeVersion
  };
}
