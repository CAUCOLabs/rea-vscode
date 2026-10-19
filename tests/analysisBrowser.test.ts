import { describe, expect, it, vi } from 'vitest';
import { browserArguments, browserCandidates, startAnalysisBrowser, type BrowserRuntime } from '../src/services/analysisBrowser';

function fixture() {
  let clock = 0;
  const stop = vi.fn(async () => {});
  const runtime: BrowserRuntime = {
    findExecutable: vi.fn(async () => '/fixture/chrome'),
    createProfile: vi.fn(async () => '/fixture/owned-temporary-profile'),
    launch: vi.fn(() => ({ alive: () => true, stop })),
    readPort: vi.fn(async () => '41235\n/devtools/browser/owned-id'),
    pages: vi.fn(async () => [{ type: 'page', url: 'https://example.test/', title: 'Example' }]),
    removeProfile: vi.fn(async () => {}),
    pause: vi.fn(async () => { clock += 250; }),
    now: () => clock
  };
  const controller = new AbortController();
  const options = { url: 'https://example.test/', signal: controller.signal, allowed: () => true };
  return { runtime, options, controller, stop };
}

describe('Owned analysis browser orchestration', () => {
  it('opens one URL in a new temporary profile and closes/removes only owned resources', async () => {
    const { runtime, options, stop } = fixture();
    const lease = await startAnalysisBrowser(options, runtime);
    expect(lease.endpoint).toBe('http://127.0.0.1:41235');
    expect(lease.target).toBe('https://example.test/');
    expect(runtime.launch).toHaveBeenCalledWith('/fixture/chrome', expect.arrayContaining(['--headless','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir=/fixture/owned-temporary-profile','https://example.test/']));
    expect(runtime.pages).toHaveBeenCalledWith('http://127.0.0.1:41235', options.signal);
    await Promise.all([lease.close(), lease.close()]);
    expect(stop).toHaveBeenCalledOnce();
    expect(runtime.removeProfile).toHaveBeenCalledOnce();
    expect(runtime.removeProfile).toHaveBeenCalledWith('/fixture/owned-temporary-profile');
  });
  it('records the final URL after normal redirects without attaching to another profile', async () => {
    const { runtime, options } = fixture();
    runtime.pages = vi.fn(async () => [{ type: 'page', url: 'https://other.example.test/login', title: 'Sign in' }]);
    const lease = await startAnalysisBrowser(options, runtime);
    expect(lease.target).toBe('https://other.example.test/login');
    expect(runtime.createProfile).toHaveBeenCalledOnce();
    await lease.close();
  });
  it('selects a stable page even when the website does not provide a title', async () => {
    const { runtime, options } = fixture();
    runtime.pages = vi.fn(async () => [{ type: 'page', url: options.url, title: '' }]);
    const lease = await startAnalysisBrowser(options, runtime);
    expect(lease.target).toBe(options.url);
    await lease.close();
  });
  it('does not start a browser when Workspace Trust or authorization is absent', async () => {
    const { runtime, options } = fixture();
    await expect(startAnalysisBrowser({ ...options, allowed: () => false }, runtime)).rejects.toThrow('Trust this workspace');
    expect(runtime.findExecutable).not.toHaveBeenCalled();
    expect(runtime.launch).not.toHaveBeenCalled();
  });
  it('gives one actionable instruction if no supported browser is installed', async () => {
    const { runtime, options } = fixture();
    runtime.findExecutable = vi.fn(async () => undefined);
    await expect(startAnalysisBrowser(options, runtime)).rejects.toThrow('Install Google Chrome or Chromium');
    expect(runtime.createProfile).not.toHaveBeenCalled();
  });
  it.each(['malformed port', 'multiple pages', 'never loaded'])('times out and cleans up for %s', async condition => {
    const { runtime, options, stop } = fixture();
    if (condition === 'malformed port') runtime.readPort = vi.fn(async () => 'http://remote.example:9222');
    if (condition === 'multiple pages') runtime.pages = vi.fn(async () => [{ type: 'page', url: options.url, title: 'A' }, { type: 'page', url: options.url, title: 'B' }]);
    if (condition === 'never loaded') runtime.pages = vi.fn(async () => [{ type: 'page', url: 'about:blank', title: '' }]);
    await expect(startAnalysisBrowser(options, runtime)).rejects.toThrow('Check the URL');
    expect(stop).toHaveBeenCalledOnce();
    expect(runtime.removeProfile).toHaveBeenCalledOnce();
  });
  it('cleans the new profile if trust changes before spawn', async () => {
    const { runtime, options } = fixture();
    let trusted = true;
    runtime.createProfile = vi.fn(async () => { trusted = false; return '/fixture/owned-temporary-profile'; });
    await expect(startAnalysisBrowser({ ...options, allowed: () => trusted }, runtime)).rejects.toThrow('Trust this workspace');
    expect(runtime.launch).not.toHaveBeenCalled();
    expect(runtime.removeProfile).toHaveBeenCalledOnce();
  });
  it('closes its own process when cancelled during preparation', async () => {
    const { runtime, options, controller, stop } = fixture();
    runtime.pause = vi.fn(async () => { controller.abort(); });
    await expect(startAnalysisBrowser(options, runtime)).rejects.toThrow();
    expect(stop).toHaveBeenCalledOnce();
    expect(runtime.removeProfile).toHaveBeenCalledOnce();
  });
  it('removes only the new profile after launch failure and does not leak exception details', async () => {
    const { runtime, options } = fixture();
    runtime.launch = vi.fn(() => { throw new Error('private executable path'); });
    await expect(startAnalysisBrowser(options, runtime)).rejects.toThrow('Update Chrome or Chromium');
    expect(runtime.removeProfile).toHaveBeenCalledWith('/fixture/owned-temporary-profile');
  });
  it('does not delete a profile while the owned process cannot be stopped', async () => {
    const { runtime, options, stop } = fixture();
    stop.mockRejectedValue(new Error('stop failed'));
    const lease = await startAnalysisBrowser(options, runtime);
    await expect(lease.close()).rejects.toThrow();
    expect(runtime.removeProfile).not.toHaveBeenCalled();
  });
  it('does not accept unsafe schemes, credentials or arbitrary command-line flags', async () => {
    const { runtime, options } = fixture();
    for (const url of ['file:///secret','javascript:alert(1)','https://user:pass@example.test/']) await expect(startAnalysisBrowser({ ...options, url }, runtime)).rejects.toThrow();
    expect(runtime.launch).not.toHaveBeenCalled();
    const args = browserArguments('/fixture/owned', 'https://example.test/?q=hello;shutdown');
    expect(args.at(-1)).toBe('https://example.test/?q=hello;shutdown');
    expect(args).not.toContain('--no-sandbox');
    expect(browserCandidates('darwin').every(path => path.startsWith('/Applications/'))).toBe(true);
    expect(browserCandidates('freebsd')).toEqual([]);
  });
});
