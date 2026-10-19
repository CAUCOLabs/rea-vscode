import { describe, expect, it, vi } from 'vitest';
import { analyzeWebTarget, decodeWebEvidence, safeText } from '../src/analysis/webTargetAnalyzer';
import { acceptsWebArguments, cdpEndpoint, targetUrl, webArguments, WEB_TOOLS, type WebTool } from '../src/services/webToolPolicy';
import { parseSidebarMessage } from '../src/views/sidebarProtocol';
import { bundle, discovery, evidenceResult, page, webResponse, webSchemas, webTarget } from './webAnalyzerFixture';

function setup(response: (tool: WebTool) => unknown = webResponse) {
  const call = vi.fn(async (tool: WebTool) => response(tool));
  const progress = vi.fn();
  const controller = new AbortController();
  return { call, progress, controller, options: { target: webTarget, endpoint: 'http://127.0.0.1:9222', tools: [...WEB_TOOLS], client: { inspectWebTarget: call }, signal: controller.signal, allowed: () => true, progress } };
}

describe('Web target workflow', () => {
  it('runs a bounded passive sequence and generates an evidence-linked coding brief', async () => {
    const { call, options, progress } = setup();
    const report = await analyzeWebTarget(options);
    expect(call.mock.calls.map(([tool]) => tool)).toEqual(['list_browser_targets', 'inspect_web_page', 'capture_web_screenshot', 'analyze_web_bundle']);
    expect(report.status).toBe('captured');
    expect(report.evidence).toHaveLength(4);
    expect(report.evidence.find(e => e.tool === 'capture_web_screenshot')?.artifact).toMatchObject({ mediaType: 'image/png', bytes: 70 });
    expect(report.findings.some(f => f.classification === 'OBSERVED' && f.area === 'Navigation')).toBe(true);
    expect(report.findings.some(f => f.classification === 'INFERRED' && f.area === 'Technology candidates')).toBe(true);
    expect(report.findings.some(f => f.classification === 'UNKNOWN' && f.area === 'Backend and data')).toBe(true);
    expect(report.findings.some(f => f.classification === 'OBSERVED' && f.area === 'Visual evidence' && f.detail.includes('1280 × 720px'))).toBe(true);
    expect(report.findings.some(f => f.classification === 'UNKNOWN' && f.area === 'Visual evidence' && f.detail.includes('element-level geometry'))).toBe(true);
    expect(report.findings.some(f => f.classification === 'UNKNOWN' && f.area === 'Interaction behavior' && f.detail.includes('passive browser'))).toBe(true);
    expect(report.findings.every(f => f.source && f.id && f.evidenceId)).toBe(true);
    expect(report.specification).toContain('PROPOSED');
    expect(report.specification).toContain('## Visual requirements');
    expect(report.specification).toContain('## Resource requirements');
    expect(report.specification).toContain('## Unknown or inaccessible functionality');
    expect(report.markdown).toContain('Instructions for coding agents');
    expect(report.markdown).toContain('Recommended implementation order');
    expect(report.markdown).toContain('SHA-256');
    expect(report.markdown).not.toContain('private-value');
    expect(report.markdown).not.toContain('DO NOT EXPORT');
    expect(report.markdown).not.toContain('<script>');
    expect(report.markdown).not.toContain('Ignored hidden control');
    expect(progress).toHaveBeenLastCalledWith(100, expect.stringContaining('Inspection captured'));
  });
  it('exports a diagnostic report, not fake findings, when CDP is unavailable', async () => {
    const { options } = setup(() => { throw new Error('raw sensitive credential'); });
    const report = await analyzeWebTarget(options);
    expect(report.status).toBe('partial');
    expect(report.findings.every(f => f.classification === 'UNKNOWN')).toBe(true);
    expect(report.markdown).toContain('--remote-debugging-port=9222');
    expect(report.markdown).not.toContain('raw sensitive');
  });
  it.each([0, 2])('does not choose an arbitrary page when %i exact tabs match', async count => {
    const { options, call } = setup(tool => evidenceResult(tool, { targets: Array.from({ length: count }, () => discovery.targets[0]) }));
    const report = await analyzeWebTarget(options);
    expect(call).toHaveBeenCalledTimes(1);
    expect(report.status).toBe('partial');
    expect(report.findings.some(f => f.area === 'Setup')).toBe(true);
  });
  it('does not substitute a different path on the same origin', async () => {
    const { options, call } = setup(tool => evidenceResult(tool, { targets: [{ ...discovery.targets[0], url: webTarget + 'different' }] }));
    expect((await analyzeWebTarget(options)).status).toBe('partial');
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('keeps usable inspection evidence if the optional bundle tool is unavailable', async () => {
    const { options, call } = setup();
    options.tools = options.tools.filter(tool => tool !== 'analyze_web_bundle');
    const report = await analyzeWebTarget(options);
    expect(call).toHaveBeenCalledTimes(3);
    expect(report.status).toBe('captured');
    expect(report.findings.some(f => f.classification === 'UNKNOWN' && f.area === 'JavaScript analysis')).toBe(true);
  });
  it('reports visual evidence as unavailable when the live catalog lacks screenshot capture', async () => {
    const { options } = setup();
    options.tools = options.tools.filter(tool => tool !== 'capture_web_screenshot');
    const report = await analyzeWebTarget(options);
    expect(report.evidence.some(e => e.tool === 'capture_web_screenshot')).toBe(false);
    expect(report.findings.some(f => f.area === 'Visual evidence' && f.classification === 'UNKNOWN' && f.detail.includes('does not include capture_web_screenshot'))).toBe(true);
  });
  it('rejects target navigation and incomplete provider payloads without claiming UI findings', async () => {
    for (const payload of [{ ...page, target: { url: webTarget + 'moved' } }, { target: page.target }]) {
      const { options } = setup(tool => tool === 'inspect_web_page' ? evidenceResult(tool, payload) : webResponse(tool));
      const report = await analyzeWebTarget(options);
      expect(report.status).toBe('partial');
      expect(report.findings.some(f => f.classification === 'OBSERVED')).toBe(false);
    }
  });
  it('stops before the next tool call when trust is lost or the signal is aborted', async () => {
    const { options, call, controller } = setup();
    options.allowed = () => call.mock.calls.length === 0;
    await expect(analyzeWebTarget(options)).rejects.toThrow('cancelled');
    expect(call).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(analyzeWebTarget({ ...options, allowed: () => true })).rejects.toThrow('cancelled');
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('marks zero requests as unknown API coverage rather than no backend', async () => {
    const { options } = setup(tool => tool === 'inspect_web_page' ? evidenceResult(tool, { ...page, network: { requests: [] } }) : webResponse(tool));
    const report = await analyzeWebTarget(options);
    expect(report.markdown).toContain('does not prove that the app has no APIs');
    expect(report.specification).toContain('mock adapters');
  });
  it('caps displayed evidence and records local omissions', async () => {
    const { options } = setup(tool => tool === 'inspect_web_page' ? evidenceResult(tool, { ...page, resources: Array.from({ length: 100 }, () => page.resources[0]) }) : webResponse(tool));
    const report = await analyzeWebTarget(options);
    expect(report.findings.filter(f => f.area === 'Resources')).toHaveLength(25);
    expect(report.findings.some(f => f.area === 'Local display limits')).toBe(true);
  });
});

describe('Web tool boundary, decoding and privacy', () => {
  it.each(['file:///tmp/target', 'javascript:alert(1)', 'https://user:pass@example.test', 'not a URL'])('rejects invalid target %s', value => {
    expect(() => targetUrl(value)).toThrow();
  });
  it.each(['http://localhost:9222', 'http://remote.example:9222', 'ws://127.0.0.1:9222/devtools/browser/id', 'http://127.0.0.1:9222/path', 'http://127.0.0.1:9222?secret=value'])('rejects unsupported CDP endpoint %s', value => {
    expect(() => cdpEndpoint(value)).toThrow();
  });
  it('validates verified schemas and never emits navigation/actions/body capture arguments', () => {
    for (const tool of WEB_TOOLS) {
      const args = webArguments(tool, 'http://127.0.0.1:9222', new URL(webTarget).origin, 'page-1');
      expect(acceptsWebArguments(tool, webSchemas[tool], args)).toBe(true);
      if (tool === 'inspect_web_page' || tool === 'analyze_web_bundle') {
        expect(args.observation_ms).toBe(500);
        expect(args.include_json_body_shapes).toBe(false);
        expect(args.include_console_text).toBe(false);
        expect(args.include_storage_keys).toBe(false);
      }
      if (tool === 'capture_web_screenshot') expect(args).toEqual({ cdp_endpoint: 'http://127.0.0.1:9222', allowed_origins: [new URL(webTarget).origin], target_id: 'page-1' });
      expect(args).not.toHaveProperty('url');
      expect(args).not.toHaveProperty('actions');
      expect(acceptsWebArguments(tool, { ...webSchemas[tool], allOf: [] }, args)).toBe(false);
    }
    expect(webArguments('analyze_web_bundle', 'http://127.0.0.1:9222', new URL(webTarget).origin, 'page-1').fetch_source_maps).toBe(false);
  });
  it('rejects summary envelopes, malformed JSON, mismatched operations and tool errors', () => {
    for (const result of [{ isError: true }, { structuredContent: { summary: 'not evidence' } }, evidenceResult('analyze_web_bundle', bundle), { content: [{ type: 'text', text: 'not JSON' }] }]) {
      expect(() => decodeWebEvidence(result, 'inspect_web_page')).toThrow();
    }
  });
  it('strips query values, fragments and credential fields without recording raw results', () => {
    const projected = safeText('https://user:pass@site.test/path?session=private#private-fragment Bearer private-bearer');
    expect(projected).not.toContain('user:pass');
    expect(projected).not.toContain('private');
    expect(safeText('Control label: {"password":"private value"}')).not.toContain('private value');
  });
  it('validates analyzer messages and refuses export paths or report bodies supplied by the view', () => {
    expect(parseSidebarMessage({ type: 'analyzeWebTarget', url: webTarget })).toBeDefined();
    expect(parseSidebarMessage({ type: 'analyzeWebTarget', url: webTarget, endpoint: 'http://127.0.0.1:9222', actions: ['click'] })).toBeUndefined();
    expect(parseSidebarMessage({ type: 'exportWebReport', path: '/tmp/overwritten.md', report: 'injected' })).toBeUndefined();
    expect(parseSidebarMessage({ type: 'exportWebReport' })).toEqual({ type: 'exportWebReport' });
  });
});

it('propagates verified PNG bytes and provenance without embedding them in Markdown', async () => {
  const report = await analyzeWebTarget(setup().options);
  expect(report.screenshot?.dataBase64).toMatch(/^iVBOR/);
  expect(report.screenshot?.evidenceId).toBe(report.evidence.find(e => e.tool === 'capture_web_screenshot')?.evidenceId);
  expect(report.markdown).not.toContain(report.screenshot!.dataBase64);
});
it('preserves the real sanitized screenshot tool failure and makes no visual claim', async () => {
  const report = await analyzeWebTarget(setup(tool => tool === 'capture_web_screenshot' ? { isError: true, content: [{ type: 'text', text: 'Viewport capture timed out' }] } : webResponse(tool)).options);
  expect(report.screenshot).toBeUndefined();
  expect(report.findings.some(f => f.area === 'Visual evidence' && f.detail.includes('Viewport capture timed out'))).toBe(true);
  expect(report.findings.some(f => f.area === 'Visual evidence' && f.classification === 'OBSERVED')).toBe(false);
});
