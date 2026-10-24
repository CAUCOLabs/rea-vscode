import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeDesktopApplication, desktopCaptureError, desktopSnapshot, exportDesktopReport, verifyDesktopScreenshot } from '../src/analysis/desktopAnalyzer';
import { parseDesktopDiscovery, type DesktopApplication, type DesktopDiscovery } from '../src/services/desktopDiscovery';
import { createDesktopHandoff } from '../src/services/desktopHandoff';
import { parseSidebarMessage } from '../src/views/sidebarProtocol';

const app: DesktopApplication = { pid: 123, name: 'Read-only fixture', bundleId: 'org.example.fixture', executable: '/Applications/Fixture.app/Contents/MacOS/Fixture', launchTime: 1234,
  windows: [{ id: 456, title: 'Fixture', bounds: { X: 10, Y: 10, Width: 420, Height: 240 } }] };
const discovery: DesktopDiscovery = { applications: [app], permissions: { accessibility: true, screenCapture: true }, windowServerAvailable: true, truncated: false, menu: { status: 'captured', items: [{ title: 'Fixture', role: 'AXMenuBarItem' }] } };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const image = { mime_type: 'image/png', base64: png.toString('base64'), sha256: createHash('sha256').update(png).digest('hex'), width: 1, height: 1 };
const nodes = [{ path: [], role: 'AXWindow', title: 'Fixture', value: null, actions: [], children_count: 1 },
  { path: [0], role: 'AXButton', title: 'Example', value: null, actions: ['AXPress'], children_count: 0 }];
const selection = { pid: app.pid, executable: app.executable, launchTime: app.launchTime!, windowId: 456 };
function response(screenshot = false) { return { content: [], structuredContent: { evidence_id: 'ev_' + 'a'.repeat(64), normalized_result: { target_sha256: 'b'.repeat(64), initial: { window: { pid: app.pid, window_id: 456, executable: app.executable, launch_time: app.launchTime }, nodes: screenshot ? [] : structuredClone(nodes), truncated: false, screenshot: screenshot ? image : null, gaps: [] }, steps: [], restore: 'leave-as-is', limitations: [] } } }; }
function setup(extra: Record<string, any> = {}) {
  const observe = vi.fn(async request => response(request.screenshot));
  const options = { application: structuredClone(app), windowId: 456, screenshot: true, launch: { command: '/bundled/node', args: ['/bundled/rea.mjs', '--mcp'] }, signal: new AbortController().signal, allowed: () => true,
    discover: vi.fn(async () => structuredClone(discovery)), observe, ...extra };
  return { observe, options };
}
it('validates fixed native discovery output and selected application/window identities', () => {
  expect(parseDesktopDiscovery(discovery).applications[0].windows[0].id).toBe(456);
  expect(() => parseDesktopDiscovery({ ...discovery, applications: [{ ...app, executable: 'relative/path' }] })).toThrow('identity');
  expect(() => parseDesktopDiscovery({ ...discovery, applications: [app, app] })).toThrow('Duplicate');
  expect(() => parseDesktopDiscovery({ error: 'Window changed' })).toThrow('Window changed');
  expect(() => parseDesktopDiscovery({ ...discovery, menu: { status: 'captured', items: [{}] } })).toThrow('menu');
});
it('delegates only fixed passive observation requests to the original REA adapter', async () => {
  const { options, observe } = setup();
  const report = await analyzeDesktopApplication(options);
  expect(observe).toHaveBeenCalledTimes(2);
  expect(observe.mock.calls[0][0]).toMatchObject({ selection, screenshot: false, launch: options.launch });
  expect(observe.mock.calls[1][0]).toMatchObject({ selection, screenshot: true });
  expect(report.accessibility.nodes[1].actions).toEqual(['AXPress']);
  expect(report.accessibility.response).toEqual(response());
  expect(report.screenshot.image?.sha256).toBe(image.sha256);
  expect(report.menu.items).toEqual(discovery.menu.items);
  expect(report.verifiedInteractions).toEqual([]); expect(report.inferredBehavior).toEqual([]);
});
it('retains accessibility evidence when Screen Recording is denied, without broad fallback', async () => {
  const { options, observe } = setup({ discover: async () => ({ ...structuredClone(discovery), permissions: { accessibility: true, screenCapture: false } }) });
  const report = await analyzeDesktopApplication(options);
  expect(report.accessibility.status).toBe('captured'); expect(report.screenshot.status).toBe('permission-denied');
  expect(report.screenshot.reason).toContain('No broad capture fallback');
  expect(observe).toHaveBeenCalledTimes(1);
});
it('can capture only the selected screenshot when accessibility is denied and never claims a tree', async () => {
  const { options } = setup({ discover: async () => ({ ...structuredClone(discovery), permissions: { accessibility: false, screenCapture: true }, menu: { status: 'permission-denied', items: [] } }) });
  const report = await analyzeDesktopApplication(options);
  expect(report.accessibility.status).toBe('permission-denied'); expect(report.accessibility.nodes).toEqual([]);
  expect(report.screenshot.status).toBe('captured');
});
it('does not request screenshot permission or capture pixels unless selected', async () => {
  const { options, observe } = setup({ screenshot: false });
  const report = await analyzeDesktopApplication(options);
  expect(report.screenshot.status).toBe('not-requested'); expect(report.screenshot.image).toBeUndefined();
  expect(observe).toHaveBeenCalledTimes(1);
});
it('preserves provider permission-denied and capture errors as actual failures', async () => {
  const { options, observe } = setup();
  observe.mockResolvedValue({ content: [{ type: 'text', text: 'accessibility-denied' }], isError: true } as any);
  const report = await analyzeDesktopApplication(options);
  expect(report.accessibility.status).toBe('permission-denied'); expect(report.accessibility.nodes).toEqual([]);
  expect(report.accessibility.response).toMatchObject({ isError: true });
  expect(desktopCaptureError({ code: 'ambiguous-window' }).status).toBe('unavailable');
});
it('rejects PID reuse, stale windows, missing launch identities and untrusted calls before REA', async () => {
  for (const extra of [
    { allowed: () => false }, { application: { ...app, launchTime: null } }, { windowId: 999 },
    { discover: async () => ({ ...discovery, applications: [{ ...app, launchTime: 9999 }] }) }
  ]) {
    const { options, observe } = setup(extra);
    await expect(analyzeDesktopApplication(options)).rejects.toThrow();
    expect(observe).not.toHaveBeenCalled();
  }
});
it('checks response identity, passive-only steps and screenshot integrity', () => {
  const value = response();
  expect(desktopSnapshot(value, selection).nodes).toHaveLength(2);
  expect(() => desktopSnapshot(value, { ...selection, pid: 124 })).toThrow('identity');
  const changed = structuredClone(value); changed.structuredContent.normalized_result.steps.push({} as never);
  expect(() => desktopSnapshot(changed, selection)).toThrow('passive');
  expect(verifyDesktopScreenshot(image).width).toBe(1);
  expect(() => verifyDesktopScreenshot({ ...image, sha256: '0'.repeat(64) })).toThrow('integrity');
  expect(() => verifyDesktopScreenshot({ ...image, width: 2 })).toThrow('integrity');
});
it('rejects observations returned after cancellation or authorization loss', async () => {
  const controller = new AbortController(), { options, observe } = setup({ signal: controller.signal });
  observe.mockImplementation(async () => { controller.abort(); return response(); });
  await expect(analyzeDesktopApplication(options)).rejects.toThrow();
  expect(observe).toHaveBeenCalledOnce();
});
it('writes evidence, verified PNG and a separate-app agent prompt into a fresh directory', async () => {
  const { options } = setup(); const report = await analyzeDesktopApplication(options);
  const parent = await mkdtemp(join(tmpdir(), 'rea-desktop-handoff-test-'));
  try {
    const destination = await createDesktopHandoff(parent, report);
    expect((await readdir(destination)).sort()).toEqual(['agent-handoff.md', 'desktop-analysis.md', 'desktop-evidence.json', 'evidence']);
    expect(await readFile(join(destination, 'evidence/window.png'))).toEqual(png);
    const evidence = JSON.parse(await readFile(join(destination, 'desktop-evidence.json'), 'utf8'));
    expect(evidence.accessibility.response).toEqual(report.accessibility.response);
    expect(evidence.untrustedContent).toBe(true);
    expect(await readFile(join(destination, 'agent-handoff.md'), 'utf8')).toContain('separate application');
    expect(exportDesktopReport(report)).toContain('No source-code access');
    expect(await createDesktopHandoff(parent, report)).not.toBe(destination);
    await expect(createDesktopHandoff(parent, { ...report, screenshot: { ...report.screenshot, image: { ...report.screenshot.image!, sha256: '0'.repeat(64) } } })).rejects.toThrow('integrity');
  } finally { await rm(parent, { recursive: true, force: true }); }
});
it('strictly parses only discovered-selection desktop messages, never executable paths or actions', () => {
  const message = { type: 'inspectDesktop', applicationId: 'a'.repeat(24), windowId: 456, screenshot: true };
  expect(parseSidebarMessage(message)).toEqual(message);
  expect(parseSidebarMessage({ ...message, executable: '/bin/sh' })).toBeUndefined();
  expect(parseSidebarMessage({ ...message, action: 'click' })).toBeUndefined();
  expect(parseSidebarMessage({ ...message, applicationId: '/tmp/target' })).toBeUndefined();
  expect(parseSidebarMessage({ ...message, windowId: -1 })).toBeUndefined();
  expect(parseSidebarMessage({ type: 'handoffDesktop', destination: '/injected' })).toBeUndefined();
});
