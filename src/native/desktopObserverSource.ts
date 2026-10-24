/** Fixed adapter to the unchanged, version-pinned REA native-only session. No target code is imported. */
export const DESKTOP_OBSERVER_JS = String.raw`
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
const input = JSON.parse(process.argv[2]);
const metadata = JSON.parse(await readFile(join(input.engineRoot, 'package.json'), 'utf8'));
if (metadata.name !== 'rea-agents' || metadata.version !== '6.7.0') throw new Error('Desktop adapter requires the unchanged REA 6.7.0 runtime.');
const moduleAt = path => import(pathToFileURL(join(input.engineRoot, path)).href);
const { createNativeBinarySession } = await moduleAt('dist/composition/binary.js');
const { createEvidence } = await moduleAt('dist/domain/evidence.js');
const { projectAnalysisError } = await moduleAt('dist/domain/analysisErrorProjection.js');
const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
process.on('SIGINT', () => controller.abort());
const timeout = setTimeout(() => controller.abort(), 150000);
const session = await createNativeBinarySession();
let response;
try {
  const opened = await session.open(input.executable, { signal: controller.signal });
  if (!opened.ok) throw opened.error;
  // Fixed passive vocabulary and bounds. No action/scenario or generic operation is admitted.
  const parameters = { pid: input.pid, window_id: input.windowId, accessibility: input.accessibility === true,
    screenshot: input.screenshot === true, max_nodes: 500 };
  const result = await session.execute('observe_native_ui', parameters, { signal: controller.signal });
  if (!result.ok) throw result.error;
  const execution = result.value;
  const evidence = createEvidence(execution.subject ?? undefined, execution.provider, {
    operation: 'observe_native_ui', parameters, result: execution.result, rawResult: execution.rawResult,
    analysisProfile: execution.analysisProfile, limitations: execution.limitations, locations: execution.locations
  });
  response = { content: [], structuredContent: evidence };
} catch (error) {
  let projected;
  try { projected = projectAnalysisError(error); } catch { projected = { message: 'Original REA native provider failed.' }; }
  response = { isError: true, content: [], structuredContent: { error: projected } };
} finally {
  const closed = await session.close();
  if (!closed.ok) response = { isError: true, content: [], structuredContent: { error: projectAnalysisError(closed.error) } };
  clearTimeout(timeout);
}
process.stdout.write(JSON.stringify(response));
`;
