import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { executionEditor } from '../src/services/readOnlyExecution';
import { readOnlySchema } from './readOnlyFixture';
import { describe, expect, it } from 'vitest';

// A small DOM double exercises the actual shipped scripts without a browser,
// external dependencies, or executing tool output as markup.
class Node {
  children: Node[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  className = '';
  hidden = false;
  disabled = false;
  open = false;
  value = '';
  title = '';
  private text = '';
  constructor(readonly tag: string) {}
  set textContent(value: string) { this.text = String(value); this.children = []; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_value: string) { throw new Error('Unsafe HTML insertion'); }
  append(...nodes: Node[]) {
    for (const node of nodes) {
      if (node.tag === '#fragment') this.children.push(...node.children);
      else this.children.push(node);
    }
  }
  replaceChildren(...nodes: Node[]) { this.text = ''; this.children = []; this.append(...nodes); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(type: string, callback: () => void) { this.listeners[type] = callback; }
  click() { if (!this.disabled) this.listeners.click?.(); }
}
function descendants(node: Node): Node[] { return node.children.flatMap(child => [child, ...descendants(child)]); }

function setup() {
  const ids = ['create-reconstruction', 'screenshot-preview', 'connect', 'disconnect', 'refresh', 'execute', 'detail', 'name', 'description', 'schema', 'parameters', 'search', 'count', 'tools', 'status', 'notice', 'result', 'result-status', 'original-response', 'original-section', 'expand-all', 'collapse-all', 'execution-policy', 'parameter-error', 'target-url', 'cdp-endpoint', 'analyze-target', 'export-report', 'analysis-progress', 'analysis-meter', 'analysis-findings', 'reconstruction-spec', 'evidence-summary', 'web-analyzer', 'target-web', 'target-github', 'target-desktop', 'coming-soon', 'connection-indicator', 'reconnect', 'open-setup', 'prepare-reconstruction', 'view-analysis', 'analysis-results', 'preparation-status', 'analysis-detail-panel', 'human-findings', 'component-summary', 'interaction-summary', 'resource-summary', 'missing-summary', 'report-target', 'analysis-status', 'report-readiness'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Node('div')]));
  const sent: unknown[] = [];
  const receivers: Array<(event: { data: unknown }) => void> = [];
  nodes['cdp-endpoint'].value = 'http://127.0.0.1:9222';
  const context = createContext({ URL,
    document: { getElementById: (id: string) => nodes[id], createElement: (tag: string) => new Node(tag), createDocumentFragment: () => new Node('#fragment') },
    window: { addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => { receivers.push(listener); } },
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => sent.push(message) })
  });
  for (const file of ['sidebarModel.js', 'sidebar.js', 'webAnalyzer.js']) {
    runInContext(readFileSync(new URL(`../media/${file}`, import.meta.url), 'utf8'), context);
  }
  return { nodes, sent, send: (data: unknown) => receivers.forEach(receive => receive({ data })), model: context.reaSidebarModel };
}
const tools = [
  { name: 'list_unknowns', description: 'List residual unknown records with complete details.', executable: true, editor: executionEditor('list_unknowns', readOnlySchema),
    inputSchema: { type: 'object', required: ['status'], properties: {
      status: { type: 'string', description: 'Exact status filter.', enum: ['open', 'resolved'] },
      limit: { type: 'integer', default: 50, minimum: 1 },
      include: { type: 'boolean', default: false },
      nested: { oneOf: [{ type: 'string' }, { type: 'object' }] }
    } } },
  { name: 'inspect_web_page', description: 'Read page information.', executable: false, inputSchema: { type: 'object' } },
  { name: 'list_frida_devices', description: 'Enumerate devices.', executable: false, inputSchema: { type: 'object' } }
];
const toolButtons = (node: Node) => descendants(node).filter(child => child.tag === 'button');

describe('Compact catalog and schema details', () => {
  it('starts collapsed and expands/collapses groups without changing search or selection', () => {
    const { nodes, send } = setup();
    send({ type: 'tools', tools });
    const groups = () => descendants(nodes.tools).filter(node => node.className === 'tool-group');
    expect(groups().every(node => !node.open)).toBe(true);
    nodes['expand-all'].click();
    expect(groups().every(node => node.open)).toBe(true);
    toolButtons(nodes.tools).find(node => node.textContent === 'list_unknowns')!.click();
    nodes['collapse-all'].click();
    expect(groups().every(node => !node.open)).toBe(true);
    nodes.search.value = 'complete details'; nodes.search.listeners.input();
    expect(nodes.name.textContent).toBe('list_unknowns');
    nodes['expand-all'].click();
    expect(nodes.search.value).toBe('complete details');
    expect(groups()[0].open).toBe(true);
  });
  it('renders vertical parameter cards with collapsible descriptions, without a table', () => {
    const { nodes, send } = setup();
    send({ type: 'tools', tools });
    toolButtons(nodes.tools).find(node => node.textContent === 'list_unknowns')!.click();
    expect(descendants(nodes.parameters).some(node => node.tag === 'table')).toBe(false);
    expect(nodes.parameters.children.every(node => node.className === 'parameter-card')).toBe(true);
    expect(descendants(nodes.parameters).filter(node => node.tag === 'details').every(node => !node.open)).toBe(true);
  });
  it('edits allowlisted filters and blocks invalid values before posting', () => {
    const { nodes, send, sent } = setup();
    send({ type: 'tools', tools: [{ ...tools[0], inputSchema: readOnlySchema }, ...tools.slice(1)] });
    send({ type: 'status', state: 'connected', trusted: true, busy: false });
    toolButtons(nodes.tools).find(node => node.textContent === 'list_unknowns')!.click();
    const input = (name: string) => descendants(nodes.parameters).find(node => (node as any).id === `parameter-${name}`)!;
    input('status').value = 'open'; input('offset').value = '10'; input('limit').value = '5';
    nodes.execute.click();
    expect(sent.at(-1)).toEqual({ type: 'execute', arguments: { status: 'open', offset: 10, limit: 5 } });
    const before = sent.length;
    input('limit').value = '101'; nodes.execute.click();
    expect(sent.length).toBe(before);
    expect(nodes['parameter-error'].textContent).toContain('limit');
    toolButtons(nodes.tools).find(node => node.textContent === 'inspect_web_page')!.click();
    expect(nodes.execute.hidden).toBe(true);
  });
  it('disables execution when the allowlisted tool has an unsupported schema', () => {
    const { nodes, send, sent } = setup();
    send({ type: 'tools', tools: [{ ...tools[0], editor: { supported: false, reason: 'Unsupported schema' } }] });
    send({ type: 'status', state: 'connected', trusted: true, busy: false });
    toolButtons(nodes.tools)[0].click();
    expect(nodes.execute.disabled).toBe(true);
    expect(nodes['execution-policy'].textContent).toContain('Unsupported schema');
    nodes.execute.click();
    expect(sent).toEqual([{ type: 'ready' }]);
  });

  it('groups by literal name prefix and keeps descriptions out of the list', () => {
    const { nodes, send } = setup();
    send({ type: 'tools', tools });
    expect(nodes.count.textContent).toBe('3 of 3 tools');
    expect(descendants(nodes.tools).filter(node => node.tag === 'summary').map(node => node.textContent)).toEqual(['inspect_* (1)', 'list_* (2)']);
    expect(toolButtons(nodes.tools).map(node => node.textContent)).toEqual(['inspect_web_page', 'list_frida_devices', 'list_unknowns']);
    expect(nodes.tools.textContent).not.toContain('List residual');
  });
  it('highlights selection, preserves it across filtering/refresh, and searches descriptions', () => {
    const { nodes, send } = setup();
    send({ type: 'tools', tools });
    toolButtons(nodes.tools).find(node => node.textContent === 'list_unknowns')!.click();
    expect(nodes.description.textContent).toBe(tools[0].description);
    expect(toolButtons(nodes.tools).find(node => node.textContent === 'list_unknowns')!.attributes['aria-pressed']).toBe('true');
    nodes.search.value = 'complete details'; nodes.search.listeners.input();
    expect(nodes.count.textContent).toBe('1 of 3 tools');
    expect(toolButtons(nodes.tools)[0].className).toContain('selected');
    send({ type: 'tools', tools: [...tools] });
    expect(nodes.name.textContent).toBe('list_unknowns');
    send({ type: 'tools', tools: [] });
    expect(nodes.detail.hidden).toBe(true);
    expect(nodes.name.textContent).toBe('');
  });
  it('shows types, required fields, defaults, and constraints while retaining raw schema', () => {
    const { nodes, send } = setup();
    send({ type: 'tools', tools });
    toolButtons(nodes.tools).find(node => node.textContent === 'list_unknowns')!.click();
    const text = nodes.parameters.textContent;
    for (const expected of ['Exact status filter.', 'Required', 'Optional', 'Default: 50', 'Default: false', 'minimum: 1', 'Allowed: open, resolved', 'Composite — see schema']) expect(text).toContain(expected);
    expect(JSON.parse(nodes.schema.textContent)).toEqual(tools[0].inputSchema);
  });
  it('keeps execution disabled for tools outside the allowlist', () => {
    const { nodes, send, sent } = setup();
    send({ type: 'tools', tools });
    send({ type: 'tools', tools: [{ ...tools[0], inputSchema: readOnlySchema }, ...tools.slice(1)] });
    send({ type: 'status', state: 'connected', trusted: true, busy: false });
    toolButtons(nodes.tools).find(node => node.textContent === 'inspect_web_page')!.click();
    expect(nodes.execute.disabled).toBe(true);
    toolButtons(nodes.tools).find(node => node.textContent === 'list_unknowns')!.click();
    nodes.execute.click();
    expect(sent.at(-1)).toEqual({ type: 'execute', arguments: { offset: 0, limit: 50 } });
    send({ type: 'status', state: 'connected', trusted: false, busy: false });
    expect(nodes.execute.disabled).toBe(true);
    expect(nodes.connect.disabled).toBe(true);
  });
});

describe('Structured results and untrusted content', () => {
  it('prefers MCP structuredContent and retains the original redacted response', () => {
    const { nodes, send } = setup();
    const text = JSON.stringify({ structuredContent: { total: 0, records: [] }, content: [{ type: 'text', text: 'fallback' }] });
    send({ type: 'result', text, isError: false });
    expect(nodes['result-status'].textContent).toBe('Success');
    expect(nodes.result.textContent).toContain('Structured content');
    expect(nodes.result.textContent).toContain('total');
    expect(nodes.result.textContent).not.toContain('fallback');
    expect(nodes['original-response'].textContent).toBe(text);
    expect(nodes['original-section'].hidden).toBe(false);
  });
  it('parses JSON text blocks and renders malicious markup only as text', () => {
    const { nodes, send } = setup();
    const malicious = '<img src=x onerror="alert(1)"><script>unsafe()</script>';
    send({ type: 'result', text: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ message: malicious }) }] }) });
    expect(nodes.result.textContent).toContain(malicious);
    expect(descendants(nodes.result).some(node => ['img', 'script'].includes(node.tag))).toBe(false);
  });
  it('distinguishes errors, pending, and cleared responses without retaining a stale success', () => {
    const { nodes, send } = setup();
    send({ type: 'result', text: JSON.stringify({ isError: true, content: [{ type: 'text', text: 'Query failed' }] }), isError: true });
    expect(nodes['result-status'].textContent).toBe('Error');
    expect(nodes['result-status'].className).toBe('result-error');
    send({ type: 'result', text: '', pending: true });
    expect(nodes['result-status'].textContent).toContain('Running');
    expect(nodes.result.textContent).toBe('');
    send({ type: 'result', text: '' });
    expect(nodes['original-section'].hidden).toBe(true);
    expect(nodes['result-status'].textContent).toBe('No result yet.');
  });
  it('bounds nested rendering and handles truncated or non-JSON output', () => {
    const { nodes, send } = setup();
    send({ type: 'result', text: JSON.stringify({ structuredContent: Object.fromEntries(Array.from({ length: 400 }, (_, index) => [index, 'value'])) }) });
    expect(nodes.result.textContent).toContain('Display limit');
    send({ type: 'result', text: '{incomplete\n[Output truncated]', isError: true });
    expect(nodes.result.textContent).toContain('Response truncated');
    expect(nodes['result-status'].textContent).toBe('Error');
  });
});


describe('Web analyzer view', () => {
  it('submits only the URL and renders evidence/specification as untrusted text', () => {
    const { nodes, sent, send } = setup();
    send({ type: 'status', state: 'connected', trusted: true, busy: false });
    nodes['target-url'].value = 'https://app.example.test/';
    nodes['analyze-target'].click();
    expect(sent.at(-1)).toEqual({ type: 'analyzeWebTarget', url: 'https://app.example.test/' });
    send({ type: 'analysisProgress', percent: 30, message: 'Inspecting page' });
    expect(nodes['analysis-progress'].textContent).toBe('Inspecting page');
    const hostile = '<img src=x onerror=alert(1)>';
    send({ type: 'analysisReport', report: { target: 'https://app.example.test/', status: 'captured', summary: 'One capture', specification: hostile, findings: [{ id: 'F1', classification: 'OBSERVED', area: 'Controls', detail: hostile, source: 'inspect_web_page', evidenceId: 'ev_fixture', path: 'normalized_result' }] } });
    expect(nodes['analysis-findings'].textContent).toContain(hostile);
    expect(nodes['reconstruction-spec'].textContent).toBe(hostile);
    expect(descendants(nodes['analysis-findings']).some(node => ['script','img'].includes(node.tag))).toBe(false);
    nodes['export-report'].click();
    expect(sent.at(-1)).toEqual({ type: 'exportWebReport' });
    send({ type: 'analysisReset' });
    expect(nodes['export-report'].disabled).toBe(true);
    expect(nodes['analysis-findings'].textContent).toBe('');
  });
  it('disables analysis/export without trust and during an active operation', () => {
    const { nodes, send } = setup();
    send({ type: 'status', state: 'connected', trusted: false, busy: false });
    expect(nodes['analyze-target'].disabled).toBe(true);
    expect(nodes['export-report'].disabled).toBe(true);
    send({ type: 'status', state: 'connected', trusted: true, busy: true });
    expect(nodes['analyze-target'].disabled).toBe(true);
    expect(nodes['target-url'].disabled).toBe(true);
  });
});


describe('Simple REA application experience', () => {
  it('marks upcoming target types honestly and never starts their workflows', () => {
    const { nodes, send, sent } = setup();
    send({ type: 'status', state: 'connected', trusted: true, busy: false });
    nodes['target-url'].value = 'https://example.test/';
    nodes['target-github'].click();
    expect(nodes['coming-soon'].textContent).toContain('GitHub analysis is coming soon');
    expect(nodes['analyze-target'].disabled).toBe(true);
    nodes['analyze-target'].click();
    nodes['target-desktop'].click();
    expect(nodes['coming-soon'].textContent).toContain('Desktop App analysis is coming soon');
    expect(nodes['analyze-target'].disabled).toBe(true);
    expect(sent).toEqual([{ type: 'ready' }]);
    nodes['target-web'].click();
    expect(nodes['analyze-target'].disabled).toBe(false);
    expect(nodes['coming-soon'].hidden).toBe(true);
  });
  it('offers Reconnect without technical connection details', () => {
    const { nodes, send, sent } = setup();
    send({ type: 'status', state: 'error', trusted: true, busy: false });
    expect(nodes['connection-indicator'].textContent).toBe('Not connected');
    expect(nodes.reconnect.hidden).toBe(false);
    expect(nodes['analysis-progress'].textContent).not.toMatch(/MCP|CDP|port|JSON/);
    nodes.reconnect.click();
    expect(sent.at(-1)).toEqual({ type: 'connect' });
  });
  it('retains a clear browser setup error when the operation finishes', () => {
    const { nodes, send } = setup();
    send({ type: 'status', state: 'connected', trusted: true, busy: true });
    send({ type: 'analysisProgress', percent: 0, message: 'Install Google Chrome or Chromium, then click Analyze again.' });
    send({ type: 'status', state: 'connected', trusted: true, busy: false });
    expect(nodes['analysis-progress'].textContent).toContain('Install Google Chrome');
    expect(nodes['analysis-results'].hidden).toBe(true);
  });
  it('shows human-readable results and prepares a brief only when evidence supports one', () => {
    const { nodes, send, sent } = setup();
    send({ type: 'status', state: 'connected', trusted: true, busy: false });
    const report = { target: 'https://example.test/', status: 'captured', summary: 'Technical evidence', specification: 'PROPOSED brief', findings: [{ classification: 'OBSERVED', id: 'F1', area: 'Interface', detail: 'Raw role details', source: 'inspect_web_page', evidenceId: 'ev_example', path: 'normalized_result' }] };
    const presentation = { status: 'Page inspected', readiness: 'Enough evidence for an initial UI brief.', canPrepare: true, components: ['Button: Save'], interactions: ['Button: Save — present, behavior not tested.'], resources: ['Possible technology: Example library. Needs confirmation.'], missing: ['Backend behavior is unknown.'] };
    send({ type: 'analysisReport', report, presentation });
    expect(nodes['analysis-results'].hidden).toBe(false);
    expect(nodes['component-summary'].textContent).toContain('Button: Save');
    expect(nodes['component-summary'].textContent).not.toContain('ev_example');
    nodes['view-analysis'].click();
    expect(nodes['analysis-detail-panel'].hidden).toBe(false);
    expect(nodes['human-findings'].textContent).not.toContain('normalized_result');
    nodes['prepare-reconstruction'].click();
    expect(sent.at(-1)).toEqual({ type: 'prepareReconstruction' });
    send({ type: 'reconstructionPrepared', specification: 'Coding-agent brief' });
    expect(nodes['preparation-status'].textContent).toContain('brief is ready');
    expect(nodes['reconstruction-spec'].textContent).toBe('Coding-agent brief');
    send({ type: 'analysisReport', report: { ...report, status: 'partial' }, presentation: { ...presentation, status: 'Analysis incomplete', canPrepare: false, components: [] } });
    expect(nodes['prepare-reconstruction'].disabled).toBe(true);
    expect(nodes['analysis-status'].textContent).toBe('Analysis incomplete');
  });
});

it('renders the screenshot with provenance and exposes creation only after preparation', () => {
  const { nodes, send, sent } = setup();
  send({ type: 'status', trusted: true, state: 'connected', busy: false });
  const report = { target: 'http://127.0.0.1:3000/', status: 'captured', findings: [], screenshot: { dataBase64: 'iVBORw==', evidenceId: 'ev_capture', sha256: 'digest', width: 1280, height: 720 } };
  send({ type: 'analysisReport', report, presentation: { status: 'Page inspected', readiness: '', canPrepare: true, components: [], interactions: [], resources: [], missing: [] } });
  expect(descendants(nodes['screenshot-preview']).find(n => n.tag === 'img')?.attributes.src).toBe('data:image/png;base64,iVBORw==');
  expect(nodes['screenshot-preview'].textContent).toContain('ev_capture');
  expect(nodes['create-reconstruction'].hidden).toBe(true);
  send({ type: 'reconstructionPrepared', specification: 'brief' });
  nodes['create-reconstruction'].click();
  expect(sent).toContainEqual({ type: 'createReconstructionProject' });
  send({ type: 'analysisReport', report: { ...report, screenshot: undefined, findings: [{ area: 'Visual evidence', classification: 'UNKNOWN', detail: 'Screenshot failed: Timeout' }] } });
  expect(descendants(nodes['screenshot-preview']).some(n => n.tag === 'img')).toBe(false);
  expect(nodes['screenshot-preview'].textContent).toContain('Timeout');
});
