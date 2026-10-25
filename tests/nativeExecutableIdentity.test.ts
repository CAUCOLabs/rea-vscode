import { access } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';

const runtimeUrl = new URL('../runtime/rea/dist/native/NativeUiHelperRuntime.js', import.meta.url).href;
const observationUrl = new URL('../runtime/rea/dist/native/NativeUiObservation.js', import.meta.url).href;

it.skipIf(process.platform !== 'darwin')('compiles the production native helper source list, preserves error JSON, and cleans its owned root', async () => {
  const { createNativeUiHelperRuntime } = await import(runtimeUrl);
  const runtime = createNativeUiHelperRuntime(process.env);
  let owned: string[] = [];
  try {
    // Darwin PIDs cannot reach this value. Reject before file or window capture;
    // no installed application is selected and no GUI permission is needed.
    const response = await runtime.invoke({ pid: 2147483647, window_id: 1,
      executable: '/nonexistent/owned-fixture', sha256: '0'.repeat(64),
      accessibility: true, screenshot: true, max_nodes: 1,
      action: { kind: 'click', path: [] } });
    expect(response).toEqual({ ok: false, code: 'target-mismatch',
      message: 'Selected PID does not expose an application executable URL' });
    owned = runtime.resources();
    expect(owned).toHaveLength(1);
    await access(owned[0]);
  } finally {
    if (!owned.length) owned = runtime.resources();
    await runtime.close();
  }
  expect(runtime.resources()).toEqual([]);
  for (const root of owned) await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
}, 100_000);

it.each(['target-mismatch', 'process-replaced', 'process-identity-unavailable', 'capture-failed'])(
  'retains the provider contract for %s and stops a scenario before invoking any action', async code => {
    const { observeNativeUi } = await import(observationUrl);
    const invoke = vi.fn(async () => ({ ok: false, code, message: 'owned test failure' }));
    const result = await observeNativeUi({ kind: 'executable', format: 'mach-o',
      path: '/owned/fixture', sha256: 'a'.repeat(64) }, 'exercise_native_ui', {
      pid: 123, window_id: 456, screenshot: true, accessibility: true,
      steps: [{ kind: 'click', path: [] }]
    }, { runtime: { signal: new AbortController().signal, invoke } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ _tag: 'AnalysisCapabilityUnavailableError',
      providerId: 'native-macos', operation: 'exercise_native_ui', reason: `${code}: owned test failure` });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toMatchObject({ executable: '/owned/fixture', sha256: 'a'.repeat(64) });
    expect(invoke.mock.calls[0][0]).not.toHaveProperty('action');
  }
);

it.skipIf(process.platform !== 'darwin')('preserves caller cancellation and cleans preparation resources', async () => {
  const { createNativeUiHelperRuntime } = await import(runtimeUrl);
  const runtime = createNativeUiHelperRuntime(process.env);
  const controller = new AbortController();
  const reason = new Error('owned test cancellation');
  controller.abort(reason);
  let owned: string[] = [];
  try {
    await expect(runtime.invoke({}, controller.signal)).rejects.toMatchObject({
      _tag: 'ExecFileOutputCancelledError', cause: reason
    });
    owned = runtime.resources();
  } finally {
    if (!owned.length) owned = runtime.resources();
    await runtime.close();
  }
  expect(runtime.resources()).toEqual([]);
  for (const root of owned) await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
});
