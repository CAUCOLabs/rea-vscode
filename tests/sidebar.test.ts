import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readOnlySchema } from './readOnlyFixture';
import { parseSidebarMessage, redact, resultText } from '../src/views/sidebarProtocol';

const mocks = vi.hoisted(() => ({
  trusted: true,
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  launch: vi.fn(),
  callTool: vi.fn(),
  transport: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  beforeProgress: undefined as (() => void) | undefined,
  provider: undefined as any,
}));
vi.mock('vscode', () => ({
  workspace: {
    get isTrusted() { return mocks.trusted; },
    onDidGrantWorkspaceTrust: vi.fn(() => ({ dispose() {} })),
    getConfiguration: () => ({ get: (key: string) => key === 'scriptPath' ? '/fixture/rea.mjs' : 'node' })
  },
  ProgressLocation: { Notification: 15 },
  Uri: { joinPath: (_base: unknown, ...parts: string[]) => parts.join('/') },
  window: {
    createOutputChannel: () => ({ appendLine: mocks.log, show() {}, dispose() {} }),
    showWarningMessage: mocks.warning, showErrorMessage: mocks.error, showInformationMessage: mocks.info,
    withProgress: async (_options: unknown, task: () => unknown) => { mocks.beforeProgress?.(); return task(); },
    registerWebviewViewProvider: (_id: string, provider: unknown) => { mocks.provider = provider; return { dispose() {} }; }
  },
  commands: {
    registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => {
      mocks.commands.set(name, callback); return { dispose() {} };
    },
    executeCommand: async (name: string) => mocks.commands.get(name)?.()
  }
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    onclose?: () => void;
    connect = mocks.launch;
    callTool = mocks.callTool;
    listTools = vi.fn(async () => ({ tools: [
      { name: 'list_unknowns', description: 'Read session records', inputSchema: readOnlySchema },
      { name: 'open_binary', description: 'Open target', inputSchema: { type: 'object' } }
    ] }));
    close = vi.fn(async () => {});
  }
}));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class { constructor(options: unknown) { mocks.transport(options); } }
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.commands.clear(); mocks.trusted = true; mocks.beforeProgress = undefined;
  mocks.launch.mockResolvedValue(undefined);
  mocks.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'No unknowns' }] });
});

async function activate() {
  const extension = await import('../src/extension');
  extension.activate({ extensionUri: 'fixture', subscriptions: [] } as any);
  return extension;
}

async function view() {
  let receive!: (value: unknown) => void;
  const postMessage = vi.fn();
  const webview = {
    options: {}, html: '', cspSource: 'vscode-webview:',
    asWebviewUri: (uri: string) => uri,
    postMessage,
    onDidReceiveMessage: (callback: typeof receive) => { receive = callback; return { dispose() {} }; }
  };
  mocks.provider.resolveWebviewView({ webview, onDidDispose: () => ({ dispose() {} }) });
  return { receive, postMessage, webview };
}

describe('Workspace Trust and MCP boundary', () => {
  it('does not create a transport on activation or an untrusted Connect', async () => {
    await activate();
    expect(mocks.transport).not.toHaveBeenCalled();
    mocks.trusted = false;
    await mocks.commands.get('rea.connect')!();
    expect(mocks.warning).toHaveBeenCalledOnce();
    expect(mocks.log).toHaveBeenCalledWith('REA MCP server launch blocked: workspace is not trusted.');
    expect(mocks.transport).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });
  it('blocks launch if trust is absent in the progress callback', async () => {
    await activate();
    mocks.beforeProgress = () => { mocks.trusted = false; };
    await mocks.commands.get('rea.connect')!();
    expect(mocks.transport).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
  });
  it('reaches the existing MCP connection in a trusted workspace', async () => {
    await activate();
    await mocks.commands.get('rea.connect')!();
    expect(mocks.transport).toHaveBeenCalledWith({ command: 'node', args: ['/fixture/rea.mjs', 'mcp'], stderr: 'pipe' });
    expect(mocks.launch).toHaveBeenCalledOnce();
  });
  it('rejects all other tool names at the client boundary', async () => {
    const { ReaMcpClient } = await import('../src/mcp/client');
    const client = new ReaMcpClient();
    await client.connect('node', []);
    await client.listTools();
    await expect(client.executeReadOnlyTool('open_binary')).rejects.toThrow('not allowed');
    expect(mocks.callTool).not.toHaveBeenCalled();
    await expect(client.executeReadOnlyTool('list_unknowns', { limit: 101 })).rejects.toThrow('allowed range');
    expect(mocks.callTool).not.toHaveBeenCalled();
    await client.executeReadOnlyTool('list_unknowns');
    expect(mocks.callTool).toHaveBeenCalledWith({ name: 'list_unknowns', arguments: { offset: 0, limit: 50 } });
  });
});

describe('Sidebar vertical slice', () => {
  it('loads a dynamic catalog and executes only the fixed read-only query', async () => {
    await activate();
    const { receive, postMessage, webview } = await view();
    expect(webview.html).toContain("default-src 'none'");
    expect(webview.html).toContain("connect-src 'none'");
    expect(webview.html).toContain("<details><summary>Raw JSON Schema</summary>");
    expect(webview.html).toContain("Original MCP response (redacted; output limit applies)");
    receive({ type: 'connect' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'tools', tools: expect.arrayContaining([expect.objectContaining({ name: 'list_unknowns', executable: true })]) })));
    receive({ type: 'execute', name: 'open_binary' });
    expect(mocks.callTool).not.toHaveBeenCalled();
    receive({ type: 'execute', arguments: {} });
    await vi.waitFor(() => expect(mocks.callTool).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', text: expect.stringContaining('No unknowns') })));
    receive({ type: 'disconnect' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'tools', tools: [] }));
  });
  it.each(['tool', 'transport'])('reports a %s error without forwarding raw exception details', async (kind) => {
    await activate();
    const { receive, postMessage } = await view();
    receive({ type: 'connect' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'tools', tools: expect.arrayContaining([expect.objectContaining({ name: 'list_unknowns' })]) })));
    if (kind === 'tool') mocks.callTool.mockResolvedValueOnce({ isError: true, content: [{ type: 'text', text: 'Tool query failed' }] });
    else mocks.callTool.mockRejectedValueOnce(new Error('Sensitive internal exception'));
    receive({ type: 'execute', arguments: {} });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', isError: true })));
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain('Sensitive internal exception');
  });
  it('validates arguments in the host and forwards only an allowlisted parameterized call', async () => {
    await activate();
    const { receive, postMessage } = await view();
    receive({ type: 'connect' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'tools', tools: expect.arrayContaining([expect.objectContaining({ name: 'list_unknowns' })]) })));
    receive({ type: 'execute', arguments: { limit: 101 } });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'notice', text: 'limit is outside its allowed range.' }));
    expect(mocks.callTool).not.toHaveBeenCalled();
    receive({ type: 'execute', arguments: { status: 'open', offset: 2, limit: 10 } });
    await vi.waitFor(() => expect(mocks.callTool).toHaveBeenCalledWith({ name: 'list_unknowns', arguments: { status: 'open', offset: 2, limit: 10 } }));
  });
  it('blocks Webview execution without workspace trust', async () => {
    await activate();
    const { receive, postMessage } = await view();
    mocks.trusted = false;
    receive({ type: 'execute', arguments: {} });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', text: expect.stringContaining('trusted workspace') })));
    expect(mocks.callTool).not.toHaveBeenCalled();
    expect(mocks.transport).not.toHaveBeenCalled();
  });
});

describe('Webview protocol and output', () => {
  it('rejects malformed messages and arbitrary arguments', () => {
    for (const value of [null, [], 'execute', {}, { type: 'evil' }, { type: 'execute', arguments: { unknown: [] } }, { type: 'execute' }]) {
      expect(parseSidebarMessage(value)).toBeUndefined();
    }
    expect(parseSidebarMessage({ type: 'execute', arguments: {} })).toEqual({ type: 'execute', arguments: {} });
  });
  it('redacts credential fields and recognizable tokens, and bounds displayed output', () => {
    expect(redact({ password: 'private-value', nested: { apiKey: 'private-value' } })).toEqual({ password: '[REDACTED]', nested: { apiKey: '[REDACTED]' } });
    expect(resultText('Bearer private-value')).not.toContain('private-value');
    expect(resultText({ content: [{ type: 'text', text: '{"api_key":"private-value"}' }] })).not.toContain('private-value');
    expect(resultText('a'.repeat(100_001))).toContain('[Output truncated]');
  });
});
