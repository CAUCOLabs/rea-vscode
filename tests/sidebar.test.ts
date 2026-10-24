import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webResponse, webSchemas, webTarget } from './webAnalyzerFixture';
import { readOnlySchema } from './readOnlyFixture';
import { parseSidebarMessage, redact, resultText } from '../src/views/sidebarProtocol';
import { bundledNodePath } from '../src/services/engineRuntime';

const mocks = vi.hoisted(() => ({
  trusted: true,
  loseConnection: undefined as (() => void) | undefined,
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
  saveDialog: vi.fn(),
  openDialog: vi.fn(),
  createProject: vi.fn(),
  writeFile: vi.fn(),
  startBrowser: vi.fn(),
  closeBrowser: vi.fn(),
  repositoryAnalyze: vi.fn(),
  repositoryHandoff: vi.fn(),
  desktopDiscover: vi.fn(),
  desktopAnalyze: vi.fn(),
  desktopHandoff: vi.fn(),
}));
vi.mock('../src/services/desktopDiscovery', () => ({ discoverDesktopApplications: mocks.desktopDiscover }));
vi.mock('../src/analysis/desktopAnalyzer', () => ({ analyzeDesktopApplication: mocks.desktopAnalyze, exportDesktopReport: () => 'desktop markdown' }));
vi.mock('../src/services/desktopHandoff', () => ({ createDesktopHandoff: mocks.desktopHandoff }));
vi.mock('../src/analysis/githubRepositoryAnalyzer', () => ({ analyzeGitHubRepository: mocks.repositoryAnalyze, exportRepositoryReport: () => 'repository markdown' }));
vi.mock('../src/services/repositoryHandoff', () => ({ createRepositoryHandoff: mocks.repositoryHandoff }));
vi.mock('../src/analysis/reconstructionProject', () => ({ createReconstructionProject: mocks.createProject }));
vi.mock('../src/services/analysisBrowser', () => ({ AnalysisBrowserError: class extends Error {}, startAnalysisBrowser: mocks.startBrowser, findBrowserExecutable: async () => '/installed/chrome' }));
vi.mock('vscode', () => ({
  EventEmitter: class { event = vi.fn(); fire() {} dispose() {} },
  lm: { registerMcpServerDefinitionProvider: vi.fn(() => ({ dispose() {} })) },
  McpStdioServerDefinition: class { constructor(public label: string, public command: string, public args: string[]) {} },
  workspace: {
    fs: { writeFile: mocks.writeFile },
    onDidChangeConfiguration: vi.fn(() => ({ dispose() {} })),
    get isTrusted() { return mocks.trusted; },
    onDidGrantWorkspaceTrust: vi.fn(() => ({ dispose() {} })),
    getConfiguration: () => ({ get: (key: string, fallback: string) => key === 'scriptPath' ? '' : fallback || 'node' })
  },
  ProgressLocation: { Notification: 15 },
  Uri: { joinPath: (_base: unknown, ...parts: string[]) => parts.join('/') },
  window: {
    showSaveDialog: mocks.saveDialog,
    showOpenDialog: mocks.openDialog,
    createOutputChannel: () => ({ appendLine: mocks.log, show() {}, dispose() {} }),
    showWarningMessage: mocks.warning, showErrorMessage: mocks.error, showInformationMessage: mocks.info,
    withProgress: async (_options: unknown, task: () => unknown) => { mocks.beforeProgress?.(); return task(); },
    registerWebviewViewProvider: (_id: string, provider: unknown) => { mocks.provider = provider; return { dispose() {} }; }
  },
  commands: {
    registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => {
      mocks.commands.set(name, callback); return { dispose() {} };
    },
    executeCommand: async (name: string, ...args: unknown[]) => mocks.commands.get(name)?.(...args)
  }
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    onclose?: () => void;
    constructor() { mocks.loseConnection = () => this.onclose?.(); }
    connect = mocks.launch;
    setNotificationHandler = vi.fn();
    callTool = mocks.callTool;
    listTools = vi.fn(async () => ({ tools: [
      { name: 'list_unknowns', description: 'Read session records', inputSchema: readOnlySchema },
      { name: 'open_binary', description: 'Open target', inputSchema: { type: 'object' } },
      ...Object.entries(webSchemas).map(([name, inputSchema]) => ({ name, inputSchema }))
    ] }));
    close = vi.fn(async () => {});
  }
}));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class { close = vi.fn(async () => {}); constructor(options: unknown) { mocks.transport(options); } }
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.commands.clear(); mocks.trusted = true; mocks.beforeProgress = undefined;
  mocks.startBrowser.mockImplementation(async (options: { url: string }) => ({ endpoint: 'http://127.0.0.1:9222', target: options.url, close: mocks.closeBrowser }));
  mocks.closeBrowser.mockResolvedValue(undefined);
  mocks.saveDialog.mockResolvedValue('chosen-report.md');
  mocks.openDialog.mockResolvedValue([{ fsPath: '/chosen/parent' }]);
  mocks.createProject.mockResolvedValue('/chosen/parent/rea-reconstruction-new');
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.desktopDiscover.mockResolvedValue({ applications: [{ pid: 123, name: 'Fixture', executable: '/Applications/Fixture', launchTime: 1234, windows: [{ id: 456, title: 'Fixture' }] }], permissions: { accessibility: true, screenCapture: true }, windowServerAvailable: true, truncated: false });
  mocks.desktopAnalyze.mockResolvedValue({ application: { name: 'Fixture', pid: 123 }, windowId: 456, accessibility: { nodes: [], status: 'captured' }, screenshot: { status: 'not-requested' } });
  mocks.desktopHandoff.mockResolvedValue('/chosen/desktop-evidence');
  mocks.repositoryAnalyze.mockResolvedValue({ target: 'https://github.com/example/app', commit: 'a'.repeat(40), files: [], entries: [], languages: [], frameworks: [], dependencies: [], rea: { status: 'captured' } });
  mocks.repositoryHandoff.mockResolvedValue('/chosen/evidence');
  mocks.launch.mockResolvedValue(undefined);
  mocks.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'No unknowns' }] });
});

async function activate() {
  const extension = await import('../src/extension');
  extension.activate({ extensionUri: { fsPath: process.cwd() }, subscriptions: [] } as any);
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
    expect(mocks.transport).toHaveBeenCalledWith({ command: bundledNodePath(process.cwd()), args: [`${process.cwd()}/runtime/rea/scripts/rea.mjs`, '--mcp'], stderr: 'pipe', maxBufferSize: 64 * 1024 * 1024 });
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


describe('Web analyzer host workflow and export', () => {
  it.each(['success', 'tool error', 'timeout', 'cleanup error'])('preserves the session after analysis and browser cleanup: %s', async kind => {
    await activate();
    const { receive, postMessage } = await view();
    mocks.callTool.mockImplementation(async ({ name }: { name: keyof typeof webSchemas }) => {
      if (name === 'capture_web_screenshot' && kind === 'timeout') throw new Error('MCP error -32001: Request timed out');
      if (name === 'capture_web_screenshot' && kind === 'tool error') return { isError: true, content: [] };
      return webResponse(name);
    });
    if (kind === 'cleanup error') mocks.closeBrowser.mockRejectedValueOnce(new Error('cleanup failed'));
    receive({ type: 'connect' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'connected', busy: false })));
    postMessage.mockClear();
    receive({ type: 'analyzeWebTarget', url: webTarget });
    await vi.waitFor(() => expect(mocks.closeBrowser).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'connected', busy: false })));
    expect(postMessage.mock.calls.filter(([message]) => message.type === 'status').every(([message]) => message.state === 'connected')).toBe(true);
    mocks.callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'still connected' }] });
    receive({ type: 'execute', arguments: {} });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', text: expect.stringContaining('still connected') })));
    expect(mocks.launch).toHaveBeenCalledOnce();
  });

  it('publishes retained partial evidence and disconnected state after bundle server failure', async () => {
    await activate();
    const { receive, postMessage } = await view();
    mocks.callTool.mockImplementation(async ({ name }: { name: keyof typeof webSchemas }) => {
      if (name === 'analyze_web_bundle') { mocks.loseConnection?.(); throw new Error('Connection closed'); }
      return webResponse(name);
    });
    receive({ type: 'connect' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'connected', busy: false })));
    receive({ type: 'analyzeWebTarget', url: webTarget });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'analysisReport', report: expect.objectContaining({ status: 'partial', screenshot: expect.any(Object), evidence: expect.arrayContaining([expect.objectContaining({ tool: 'inspect_web_page' })]) }) })));
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'disconnected' }));
    expect(mocks.closeBrowser).toHaveBeenCalledOnce();
  });

  it('inspects using the closed policy and exports only the host-generated report', async () => {
    await activate();
    const { receive, postMessage, webview } = await view();
    expect(webview.html).toContain('Plan your own implementation.');
    expect(webview.html).toContain('Advanced / Developer Tools');
    mocks.callTool.mockImplementation(async ({ name }: { name: keyof typeof webSchemas }) => webResponse(name));
    receive({ type: 'connect' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'connected', busy: false })));
    receive({ type: 'analyzeWebTarget', url: webTarget });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'analysisReport', report: expect.objectContaining({ status: 'captured' }) })));
    expect(mocks.startBrowser).toHaveBeenCalledWith(expect.objectContaining({ url: webTarget, allowed: expect.any(Function) }));
    expect(mocks.closeBrowser).toHaveBeenCalledOnce();
    expect(mocks.callTool.mock.calls.map(([request]) => request.name)).toEqual(['list_browser_targets', 'inspect_web_page', 'capture_web_screenshot', 'analyze_web_bundle']);
    receive({ type: 'prepareReconstruction' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'reconstructionPrepared', specification: expect.stringContaining('Proposed application structure') })));
    receive({ type: 'createReconstructionProject', destination: '/injected' });
    expect(mocks.openDialog).not.toHaveBeenCalled();
    receive({ type: 'createReconstructionProject' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'projectCreated', message: expect.stringContaining('Reconstruction project created:') })));
    expect(mocks.openDialog).toHaveBeenCalledWith(expect.objectContaining({ canSelectFolders: true, canSelectFiles: false }));
    expect(mocks.createProject).toHaveBeenCalledWith('/chosen/parent', expect.objectContaining({ status: 'captured', screenshot: expect.objectContaining({ dataBase64: expect.stringContaining('iVBOR') }) }), expect.stringMatching(/^rea-reconstruction-/), undefined);
    mocks.openDialog.mockResolvedValueOnce(undefined);
    receive({ type: 'createReconstructionProject' });
    await vi.waitFor(() => expect(mocks.openDialog).toHaveBeenCalledTimes(2));
    expect(mocks.createProject).toHaveBeenCalledOnce();
    expect(mocks.callTool).toHaveBeenCalledTimes(4);
    const inspection = mocks.callTool.mock.calls[1];
    expect(inspection[0].arguments).toMatchObject({ observation_ms: 500, include_accessibility_text: true, include_console_text: false, include_json_body_shapes: false, include_script_sources: false });
    expect(inspection[2]).toMatchObject({ timeout: 60_000, maxTotalTimeout: 60_000 });
    receive({ type: 'exportWebReport', path: '/tmp/unauthorized', report: 'injected' });
    expect(mocks.saveDialog).not.toHaveBeenCalled();
    receive({ type: 'exportWebReport' });
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalledOnce());
    const [destination, bytes] = mocks.writeFile.mock.calls[0];
    expect(destination).toBe('chosen-report.md');
    const markdown = new TextDecoder().decode(bytes);
    expect(markdown).toContain('# REA Web Target Reconstruction Report');
    expect(markdown).toContain('PROPOSED');
    expect(markdown).not.toContain('private-value');
    expect(markdown).not.toContain('injected');
  });
  it('never calls a browser tool in an untrusted workspace', async () => {
    await activate();
    const { receive, postMessage } = await view();
    mocks.trusted = false;
    receive({ type: 'analyzeWebTarget', url: webTarget });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'analysisProgress', message: expect.stringContaining('workspace') })));
    expect(mocks.callTool).not.toHaveBeenCalled();
    expect(mocks.transport).not.toHaveBeenCalled();
    receive({ type: 'exportWebReport' });
    expect(mocks.saveDialog).not.toHaveBeenCalled();
  });
  it('does not write a file when the save dialog is cancelled', async () => {
    await activate();
    const { receive, postMessage } = await view();
    mocks.callTool.mockImplementation(async ({ name }: { name: keyof typeof webSchemas }) => webResponse(name));
    receive({ type: 'connect' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'connected', busy: false })));
    receive({ type: 'analyzeWebTarget', url: webTarget });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'analysisReport' })));
    mocks.saveDialog.mockResolvedValueOnce(undefined);
    receive({ type: 'exportWebReport' });
    await vi.waitFor(() => expect(mocks.saveDialog).toHaveBeenCalledOnce());
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});


describe('Simple startup and recovery', () => {
  it('connects automatically once when the view becomes ready without opening a browser', async () => {
    await activate();
    const { receive, postMessage, webview } = await view();
    receive({ type: 'ready' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'connected', busy: false })));
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(mocks.startBrowser).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
    const primary = webview.html.split('<details id="advanced-explorer">')[0];
    expect(primary).not.toMatch(/MCP|CDP|JSON Schema|9222|Evidence ID/);
    expect(webview.html).toContain('<details id="advanced-explorer"><summary>Advanced / Developer Tools</summary>');
    receive({ type: 'ready' });
    expect(mocks.launch).toHaveBeenCalledOnce();
  });
  it('does not auto-launch REA in an untrusted workspace', async () => {
    await activate();
    const { receive } = await view();
    mocks.trusted = false;
    receive({ type: 'ready' });
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.startBrowser).not.toHaveBeenCalled();
  });
  it('allows a manual reconnect after a failed automatic connection without exposing SDK errors', async () => {
    await activate();
    const { receive, postMessage } = await view();
    mocks.launch.mockRejectedValueOnce(new Error('sensitive internal exception'));
    receive({ type: 'ready' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'error', busy: false })));
    expect(mocks.error).not.toHaveBeenCalled();
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain('sensitive internal exception');
    receive({ type: 'connect' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'connected', busy: false })));
    expect(mocks.launch).toHaveBeenCalledTimes(2);
  });
  it('shows an actionable browser error without publishing a successful report', async () => {
    const { AnalysisBrowserError } = await import('../src/services/analysisBrowser');
    await activate();
    const { receive, postMessage } = await view();
    receive({ type: 'ready' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'connected', busy: false })));
    mocks.startBrowser.mockRejectedValueOnce(new AnalysisBrowserError('Install Google Chrome or Chromium, then click Analyze again.'));
    receive({ type: 'analyzeWebTarget', url: webTarget });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'analysisProgress', message: expect.stringContaining('Install Google Chrome') })));
    expect(postMessage.mock.calls.some(([message]) => message.type === 'analysisReport')).toBe(false);
    expect(mocks.callTool).not.toHaveBeenCalled();
  });
});

it('passes captured scenario evidence into the generated project for agent consumption', async () => {
  await activate();
  const { receive, postMessage } = await view();
  mocks.callTool.mockImplementation(async ({ name }: { name: string }) => name === 'capture_browser_scenario'
    ? { content: [], structuredContent: { evidence_id: 'ev_' + 'd'.repeat(64), normalized_result: { completeness: { status: 'complete' }, steps: [{ step_id: 'initial_observation', status: 'completed', artifacts: { dom: { state: 'captured', value: { text: '<main>Captured fixture</main>' } } } }] } } }
    : webResponse(name as keyof typeof webSchemas));
  receive({ type: 'connect' });
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'connected', busy: false })));
  receive({ type: 'analyzeWebTarget', url: webTarget });
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'analysisReport' })));
  mocks.info.mockResolvedValueOnce('Continue');
  receive({ type: 'exploreWebInteractions' });
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'scenarioEvidence', evidence: expect.objectContaining({ dom: '<main>Captured fixture</main>' }) })));
  receive({ type: 'createReconstructionProject' });
  await vi.waitFor(() => expect(mocks.createProject).toHaveBeenCalledWith('/chosen/parent', expect.anything(), expect.stringMatching(/^rea-reconstruction-/), expect.objectContaining({ target: webTarget, evidenceId: 'ev_' + 'd'.repeat(64), dom: '<main>Captured fixture</main>' })));
});


describe('GitHub repository sidebar workflow', () => {
  it('analyzes public repository input through the bounded host service and exports its report', async () => {
    await activate();
    const { receive, postMessage, webview } = await view();
    expect(webview.html).toContain('>GitHub</button>');
    expect(webview.html).not.toContain('GitHub<span>Coming soon');
    receive({ type: 'connect' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'connected', busy: false })));
    receive({ type: 'analyzeGitHubRepository', url: 'https://github.com/example/app' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'repositoryReport' })));
    expect(mocks.repositoryAnalyze).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://github.com/example/app', signal: expect.any(AbortSignal) }));
    receive({ type: 'exportRepositoryReport' });
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalled());
    expect(new TextDecoder().decode(mocks.writeFile.mock.calls[0][1])).toBe('repository markdown');
    expect(mocks.startBrowser).not.toHaveBeenCalled();
  });
  it('blocks untrusted requests and reports service failures without showing a report', async () => {
    await activate(); const { receive, postMessage } = await view();
    mocks.trusted = false;
    receive({ type: 'analyzeGitHubRepository', url: 'https://github.com/example/app' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'analysisProgress', message: expect.stringContaining('Trust') })));
    expect(mocks.repositoryAnalyze).not.toHaveBeenCalled();
    mocks.trusted = true;
    receive({ type: 'connect' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'connected', busy: false })));
    mocks.repositoryAnalyze.mockRejectedValueOnce(new Error('GitHub public API rate limit reached'));
    receive({ type: 'analyzeGitHubRepository', url: 'https://github.com/example/app' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'analysisProgress', message: expect.stringContaining('rate limit') })));
    expect(postMessage.mock.calls.some(([m]) => m.type === 'repositoryReport')).toBe(false);
  });
  it('aborts repository analysis on disconnect and rejects injected output locations', async () => {
    await activate(); const { receive, postMessage } = await view();
    receive({ type: 'connect' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'connected', busy: false })));
    let operationSignal: AbortSignal | undefined;
    mocks.repositoryAnalyze.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
      operationSignal = signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    });
    receive({ type: 'analyzeGitHubRepository', url: 'https://github.com/example/app' });
    await vi.waitFor(() => expect(operationSignal).toBeDefined());
    mocks.loseConnection?.();
    await vi.waitFor(() => expect(operationSignal?.aborted).toBe(true));
    receive({ type: 'handoffRepository', destination: '/injected' });
    expect(mocks.repositoryHandoff).not.toHaveBeenCalled();
    expect(postMessage.mock.calls.some(([m]) => m.type === 'repositoryReport')).toBe(false);
  });
});


describe('Desktop host workflow', () => {
  it('binds selection to discovered app/window IDs, generates evidence and exports the report', async () => {
    await activate(); const { receive, postMessage, webview } = await view();
    expect(webview.html).toContain('>Desktop App</button>');
    expect(webview.html).not.toContain('Coming soon');
    receive({ type: 'connect' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', state: 'connected', busy: false })));
    receive({ type: 'inspectDesktop', applicationId: 'a'.repeat(24), windowId: 456, screenshot: true });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'analysisProgress', message: expect.stringContaining('Discover running') })));
    expect(mocks.desktopAnalyze).not.toHaveBeenCalled();
    receive({ type: 'discoverDesktop' });
    await vi.waitFor(() => expect(postMessage.mock.calls.some(([m]) => m.type === 'desktopApplications' && m.applications.length === 1)).toBe(true));
    const applications = postMessage.mock.calls.find(([m]) => m.type === 'desktopApplications' && m.applications.length === 1)![0].applications;
    expect(applications[0].executable).toBeUndefined();
    receive({ type: 'inspectDesktop', applicationId: applications[0].id, windowId: 999, screenshot: true });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', busy: false })));
    expect(mocks.desktopAnalyze).not.toHaveBeenCalled();
    receive({ type: 'inspectDesktop', applicationId: applications[0].id, windowId: 456, screenshot: true });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'desktopReport' })));
    expect(mocks.desktopAnalyze).toHaveBeenCalledWith(expect.objectContaining({ application: expect.objectContaining({ pid: 123, executable: '/Applications/Fixture' }), windowId: 456, screenshot: true }));
    receive({ type: 'exportDesktopReport' });
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalled());
    expect(new TextDecoder().decode(mocks.writeFile.mock.calls[0][1])).toBe('desktop markdown');
    expect(mocks.startBrowser).not.toHaveBeenCalled();
    expect(mocks.repositoryAnalyze).not.toHaveBeenCalled();
  });
  it('blocks untrusted discovery and surfaces real helper errors', async () => {
    await activate(); const { receive, postMessage } = await view();
    mocks.trusted = false; receive({ type: 'discoverDesktop' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'status', busy: false })));
    expect(mocks.desktopDiscover).not.toHaveBeenCalled();
    mocks.trusted = true; mocks.desktopDiscover.mockRejectedValueOnce(new Error('Local macOS GUI session required'));
    receive({ type: 'discoverDesktop' });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'desktopApplications', applications: [], message: 'Local macOS GUI session required' }));
  });
});
