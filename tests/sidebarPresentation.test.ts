import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
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
  const ids = ['connect', 'disconnect', 'refresh', 'execute', 'detail', 'name', 'description', 'schema', 'parameters', 'search', 'count', 'tools', 'status', 'notice', 'result', 'result-status', 'original-response', 'original-section'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Node('div')]));
  const sent: unknown[] = [];
  let receive!: (event: { data: unknown }) => void;
  const context = createContext({
    document: { getElementById: (id: string) => nodes[id], createElement: (tag: string) => new Node(tag), createDocumentFragment: () => new Node('#fragment') },
    window: { addEventListener: (_type: string, listener: typeof receive) => { receive = listener; } },
    acquireVsCodeApi: () => ({ postMessage: (message: unknown) => sent.push(message) })
  });
  for (const file of ['sidebarModel.js', 'sidebar.js']) {
    runInContext(readFileSync(new URL(`../media/${file}`, import.meta.url), 'utf8'), context);
  }
  return { nodes, sent, send: (data: unknown) => receive({ data }), model: context.reaSidebarModel };
}
const tools = [
  { name: 'list_unknowns', description: 'List residual unknown records with complete details.', executable: true,
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
    send({ type: 'status', state: 'connected', trusted: true, busy: false });
    toolButtons(nodes.tools).find(node => node.textContent === 'inspect_web_page')!.click();
    expect(nodes.execute.disabled).toBe(true);
    toolButtons(nodes.tools).find(node => node.textContent === 'list_unknowns')!.click();
    nodes.execute.click();
    expect(sent.at(-1)).toEqual({ type: 'execute' });
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
