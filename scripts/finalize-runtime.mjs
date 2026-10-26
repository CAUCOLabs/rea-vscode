import { publishRuntime } from './publish-runtime.mjs';
import { saveRuntimeCandidate } from './save-runtime-candidate.mjs';

export async function finalizeRuntime({
  projectRoot,
  stagedRuntime,
  target,
  prepareOnly = false,
  preservePreviousRuntime = false,
  saveCandidate = saveRuntimeCandidate,
  publish = publishRuntime
}) {
  if (prepareOnly) {
    const candidate = await saveCandidate({
      projectRoot,
      stagedRuntime,
      target
    });

    return {
      mode: 'candidate',
      ...candidate
    };
  }

  const publication = await publish({
    projectRoot,
    stagedRuntime,
    target,
    preservePreviousRuntime
  });

  return {
    mode: 'published',
    ...publication
  };
}
