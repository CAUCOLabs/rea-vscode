import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { access, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const state = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: state.spawn }));
import { observeDesktopWindow } from '../src/services/desktopObserver';
import { DESKTOP_OBSERVER_JS } from '../src/native/desktopObserverSource';
const selection = { pid: 123, executable: '/Applications/Fixture.app/Contents/MacOS/Fixture', launchTime: 1234, windowId: 456 };
const launch = { command: '/engine/node', args: ['/engine/scripts/rea.mjs', '--mcp'] };
let child: any;
beforeEach(() => {
  vi.clearAllMocks();
  child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.kill = vi.fn(() => { queueMicrotask(() => child.emit('close', 0)); return true; });
  state.spawn.mockImplementation(() => child);
});
afterEach(() => vi.useRealTimers());
it('executes only the fixed adapter with selected data and removes its temporary script', async () => {
  const pending = observeDesktopWindow({ launch, selection, screenshot: false, signal: new AbortController().signal });
  await vi.waitFor(() => expect(state.spawn).toHaveBeenCalledOnce());
  const [command, args, options] = state.spawn.mock.calls[0];
  expect(command).toBe('/engine/node'); expect(options.shell).toBe(false);
  expect(await readFile(args[0], 'utf8')).toBe(DESKTOP_OBSERVER_JS);
  expect(JSON.parse(args[1])).toEqual({ engineRoot: '/engine', executable: selection.executable, pid: 123, windowId: 456, accessibility: true, screenshot: false });
  child.stdout.emit('data', Buffer.from('{"content":[],"structuredContent":{"actual":"provider evidence"}}')); child.emit('close', 0);
  expect(await pending).toMatchObject({ structuredContent: { actual: 'provider evidence' } });
  await expect(access(dirname(args[0]))).rejects.toThrow();
  expect(DESKTOP_OBSERVER_JS).toContain("session.execute('observe_native_ui'");
  expect(DESKTOP_OBSERVER_JS).toContain('createNativeBinarySession');
  expect(DESKTOP_OBSERVER_JS).not.toContain('capture_native_ui_scenario');
});
it('waits for the original worker to close on cancellation before cleaning its script', async () => {
  const controller = new AbortController();
  const pending = observeDesktopWindow({ launch, selection, screenshot: true, signal: controller.signal });
  const checked = expect(pending).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(state.spawn).toHaveBeenCalledOnce());
  controller.abort(); await checked;
  expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  await expect(access(dirname(state.spawn.mock.calls[0][1][0]))).rejects.toThrow();
});
it('rejects malformed JSON and worker failures instead of substituting native evidence', async () => {
  for (const code of [0, 1]) {
    state.spawn.mockClear();
    const pending = observeDesktopWindow({ launch, selection, screenshot: true, signal: new AbortController().signal });
    const checked = expect(pending).rejects.toThrow(code ? 'adapter failed' : 'invalid JSON');
    await vi.waitFor(() => expect(state.spawn).toHaveBeenCalledOnce());
    child.stdout.emit('data', Buffer.from('not JSON')); child.emit('close', code);
    await checked;
    await expect(access(dirname(state.spawn.mock.calls[0][1][0]))).rejects.toThrow();
  }
});
it('does not start a native adapter for an already cancelled operation', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(observeDesktopWindow({ launch, selection, screenshot: false, signal: controller.signal })).rejects.toThrow();
  expect(state.spawn).not.toHaveBeenCalled();
});
