import { lstat, readdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { withRuntimePublicationLock } from './runtime-lock.mjs';
import { validatePreparedRuntime } from './validate-runtime.mjs';

const supportedTargets = new Set(['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64']);

async function inspectDirectory(directory) {
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`Expected a real directory: ${directory}`);
    }
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function validateRuntime(directory) {
  if (!await inspectDirectory(directory)) {
    throw new Error(`Runtime directory missing: ${directory}`);
  }

  const entries = (await readdir(directory)).sort();

  if (JSON.stringify(entries) !== JSON.stringify(['node', 'rea'])) {
    throw new Error(
      `Unexpected runtime components: ${entries.join(', ')}`
    );
  }

  for (const component of ['rea', 'node']) {
    if (!await inspectDirectory(path.join(directory, component))) {
      throw new Error(`Missing runtime component: ${component}`);
    }
  }
}

export async function publishRuntime({
  projectRoot,
  stagedRuntime,
  target,
  // Internal test seam; production callers always use the full validator.
  validateCandidate = validatePreparedRuntime,
  preservePreviousRuntime = false,
  onStep = () => {}
}) {
  if (!supportedTargets.has(target)) {
    throw new Error('An explicit supported runtime publication target is required');
  }
  const root = path.resolve(projectRoot);

  return withRuntimePublicationLock(root, async () => {
  const destination = path.join(root, 'runtime');
  const backup = path.join(root, '.runtime-previous-active');
  const cleanup = path.join(root, '.runtime-cleanup-pending');

  const source = path.resolve(stagedRuntime);

  if (
    source === destination ||
    source.startsWith(destination + path.sep) ||
    source.startsWith(backup + path.sep) ||
    source.startsWith(cleanup + path.sep) ||
    source === backup ||
    source === cleanup ||
    source === root ||
    !source.startsWith(root + path.sep)
  ) {
    throw new Error('Invalid staged runtime location');
  }

  // lstat of the leaf alone does not reject symbolic parent directories.
  for (let directory = path.dirname(source); ; directory = path.dirname(directory)) {
    if (!await inspectDirectory(directory)) {
      throw new Error(`Staging parent missing: ${directory}`);
    }
    if (directory === root) break;
  }

  // Never overwrite an unresolved backup.
  if (await inspectDirectory(backup)) {
    throw new Error(
      `Previous runtime backup exists: ${backup}. Recovery required.`
    );
  }

  if (await inspectDirectory(cleanup)) {
    throw new Error(
      `Previous runtime cleanup is pending: ${cleanup}`
    );
  }

  await validateRuntime(source);
  await validateCandidate(source, target);

  const hadPrevious = await inspectDirectory(destination);

  if (hadPrevious) {
    await validateRuntime(destination);
  }

  let backedUp = false;
  let published = false;

  try {
    if (hadPrevious) {
      await rename(destination, backup);
      backedUp = true;
      onStep('backup-created');
    }

    await rename(source, destination);
    published = true;
    onStep('runtime-published');

    await validateRuntime(destination);
    await validateCandidate(destination, target);
    onStep('runtime-validated');

  } catch (error) {
    if (published) {
      // Preserve the new runtime before restoring the previous one.
      const failed = path.join(root, '.runtime-failed-publish');

      let failedDestination = failed;

      try {
        if (await inspectDirectory(failed)) {
          failedDestination = path.join(
            root,
            `.runtime-failed-publish-${randomUUID()}`
          );

          if (await inspectDirectory(failedDestination)) {
            throw new Error(
              `Diagnostic destination already exists: ${failedDestination}`
            );
          }
        }

        await rename(destination, failedDestination);
      } catch (relocationError) {
        throw new AggregateError(
          [error, relocationError],
          'Runtime publication failed and rollback is incomplete: ' +
          'the new runtime could not be moved to diagnostics. ' +
          'Manual inspection is required.'
        );
      }
    }

    if (backedUp) {
      try {
        await rename(backup, destination);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          'Runtime publication failed and rollback is incomplete: ' +
          'the previous runtime could not be restored. ' +
          'Manual recovery is required.'
        );
      }
    }

    throw error;
  }

  // Preserve the previous runtime for functional verification.
  // A subsequent publication is blocked while this backup exists.
  if (backedUp && preservePreviousRuntime) {
    return {
      published: true,
      cleanupPending: false,
      previousRuntimePreserved: true,
      backup
    };
  }

  // Publication succeeded. Mark the backup as cleanup-only
  // before beginning any potentially partial deletion.
  if (backedUp) {
    try {
      await rename(backup, cleanup);
    } catch (error) {
      return {
        published: true,
        cleanupPending: true,
        backup,
        cleanupError: error.message
      };
    }

    try {
      await rm(cleanup, { recursive: true });
    } catch (error) {
      return {
        published: true,
        cleanupPending: true,
        cleanup,
        cleanupError: error.message
      };
    }
  }

  return { published: true, cleanupPending: false };
  });

}

export async function recoverInterruptedRuntime(projectRoot) {
  const root = path.resolve(projectRoot);

  return withRuntimePublicationLock(root, async () => {
  const destination = path.join(root, 'runtime');
  const backup = path.join(root, '.runtime-previous-active');

  const hasBackup = await inspectDirectory(backup);
  const hasRuntime = await inspectDirectory(destination);

  if (!hasBackup) {
    return {
      recovered: false,
      reason: 'no-backup'
    };
  }

  // An existing runtime must never be overwritten automatically.
  if (hasRuntime) {
    return {
      recovered: false,
      reason: 'runtime-already-present',
      backup
    };
  }

  await validateRuntime(backup);
  await rename(backup, destination);
  await validateRuntime(destination);

  return {
    recovered: true,
    reason: 'restored-previous-runtime'
  };
  });
}
