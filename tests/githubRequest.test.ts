import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('node:https', () => ({ get: state.get }));
import { requestGitHub } from '../src/services/githubRepository';
let status = 200, body = '{}';
beforeEach(() => {
  vi.clearAllMocks(); status = 200; body = '{}';
  state.get.mockImplementation((options, callback) => {
    const request = new EventEmitter() as any;
    request.destroy = (error: Error) => { request.emit('error', error); request.emit('close'); };
    queueMicrotask(() => {
      if (options.signal.aborted) return request.destroy(new Error('aborted'));
      const response = Readable.from([Buffer.from(body)]) as any;
      response.statusCode = status;
      response.on('close', () => request.emit('close'));
      callback(response);
    });
    return request;
  });
});
afterEach(() => vi.useRealTimers());
it('uses a fixed HTTPS origin with no authentication or ambient repository URL', async () => {
  body = '{"ok":true}';
  expect(await requestGitHub('/repos/example/app', new AbortController().signal, 100)).toEqual({ ok: true });
  expect(state.get.mock.calls[0][0]).toMatchObject({ hostname: 'api.github.com', path: '/repos/example/app', headers: { Accept: 'application/vnd.github+json' } });
  expect(state.get.mock.calls[0][0].headers.Authorization).toBeUndefined();
  await expect(requestGitHub('https://evil.test/path', new AbortController().signal, 100)).rejects.toThrow('Invalid');
  expect(state.get).toHaveBeenCalledOnce();
});
it.each([[404, 'not found'], [403, 'rate limit'], [429, 'rate limit'], [409, 'empty'], [301, 'canonical URL'], [500, 'HTTP 500']])('reports HTTP %s without redirecting or retry loops', async (code, message) => {
  status = code as number;
  await expect(requestGitHub('/repos/example/app', new AbortController().signal, 100)).rejects.toThrow(message as string);
  expect(state.get).toHaveBeenCalledOnce();
});
it('rejects oversized responses and malformed JSON', async () => {
  body = 'x'.repeat(101);
  await expect(requestGitHub('/repos/example/app', new AbortController().signal, 100)).rejects.toThrow('size limit');
  body = 'not JSON';
  await expect(requestGitHub('/repos/example/app', new AbortController().signal, 100)).rejects.toThrow('invalid JSON');
});
it('honors cancellation and a finite request deadline', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(requestGitHub('/repos/example/app', controller.signal, 100)).rejects.toThrow('cancelled');
  vi.useFakeTimers();
  state.get.mockImplementation(() => {
    const request = new EventEmitter() as any;
    request.destroy = (error: Error) => { request.emit('error', error); request.emit('close'); };
    return request;
  });
  const pending = requestGitHub('/repos/example/app', new AbortController().signal, 100);
  const checked = expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(20000);
  await checked;
});
