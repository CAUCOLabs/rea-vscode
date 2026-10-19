import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ trusted: true, provider: undefined as any, commands: new Map<string, Function>(), read: vi.fn(), write: vi.fn(), changed: vi.fn(), folders: undefined as any, select: vi.fn(), error: vi.fn(), info: vi.fn(), stat: vi.fn(), access: vi.fn() }));
vi.mock('node:fs/promises', () => ({ stat: state.stat, access: state.access }));
vi.mock('vscode', () => ({
  FileType: { Directory: 2 },
  EventEmitter: class { event = state.changed; fire() {} dispose() {} },
  FileSystemError: class extends Error { code = 'FileNotFound'; },
  McpStdioServerDefinition: class { constructor(public label: string, public command: string, public args: string[], public env: unknown, public version: string) {} },
  lm: { registerMcpServerDefinitionProvider: (_: string, provider: unknown) => { state.provider = provider; return { dispose() {} }; } },
  workspace: {
    get isTrusted() { return state.trusted; },
    getConfiguration: () => ({ get: (key: string) => key === 'executable' ? '/usr/bin/node' : '/fixture/rea.mjs' }),
    onDidChangeConfiguration: () => ({ dispose() {} }), onDidGrantWorkspaceTrust: () => ({ dispose() {} }),
    get workspaceFolders() { return state.folders; },
    fs: { stat: vi.fn(async () => ({ type: 2 })), readFile: state.read, writeFile: state.write, createDirectory: vi.fn() },
    openTextDocument: vi.fn(async (x: unknown) => x)
  },
  commands: { registerCommand: (key: string, callback: Function) => { state.commands.set(key, callback); return { dispose() {} }; } },
  Uri: { joinPath: (...parts: string[]) => parts.map(p => typeof p === 'string' ? p : (p as any).fsPath).join('/') },
  window: { showOpenDialog: state.select, showErrorMessage: state.error, showTextDocument: vi.fn(), showInformationMessage: state.info, showWarningMessage: vi.fn() }
}));
import { codexConfiguration, launchConfiguration, mergeCodexConfiguration, validateCodexLaunch, registerAgentIntegration } from '../src/services/agentIntegration';
beforeEach(() => { vi.clearAllMocks(); state.trusted = true; state.commands.clear(); state.folders = undefined; state.select.mockResolvedValue([{ scheme: 'file', fsPath: '/chosen-project' }]); state.stat.mockResolvedValue({ isFile: () => true }); state.access.mockResolvedValue(undefined); });
it('provides the real engine with no catalog proxy or allowlist and enforces trust', () => {
  registerAgentIntegration({ subscriptions: [] } as any);
  const definitions = state.provider.provideMcpServerDefinitions();
  expect(definitions[0]).toMatchObject({ command: '/usr/bin/node', args: ['/fixture/rea.mjs','mcp'] });
  state.trusted = false;
  expect(state.provider.provideMcpServerDefinitions()).toEqual([]);
  expect(() => state.provider.resolveMcpServerDefinition(definitions[0])).toThrow('trusted');
});
it('writes separate Codex project configuration while retaining existing settings', async () => {
  registerAgentIntegration({ subscriptions: [] } as any);
  state.read.mockResolvedValue(Buffer.from('model = "example"\n'));
  await state.commands.get('rea.configureCodex')!();
  const [uri, bytes] = state.write.mock.calls[0];
  expect(uri).toBe('/chosen-project/.codex/config.toml');
  expect(bytes.toString()).toContain('model = "example"');
  expect(bytes.toString()).toContain('[mcp_servers.rea]');
  expect(bytes.toString()).toContain('default_tools_approval_mode = "prompt"');
  expect(bytes.toString()).not.toMatch(/enabled_tools|disabled_tools/);
});
it('preserves existing MCP tables for review rather than corrupting TOML', async () => {
  registerAgentIntegration({ subscriptions: [] } as any);
  state.read.mockResolvedValue(Buffer.from('[mcp_servers.rea]\ncommand = "existing"\n'));
  await state.commands.get('rea.configureCodex')!(); expect(state.write).not.toHaveBeenCalled();
});
it('validates launch paths and escapes Codex values', () => {
  expect(() => launchConfiguration('node','relative')).toThrow('absolute');
  expect(codexConfiguration('C:\\node.exe', ['a"b'])).toContain('C:\\\\node.exe');
});
it('selects a folder in an empty Extension Host and explains which Codex must reload', async () => {
  registerAgentIntegration({ subscriptions: [] } as any);
  state.read.mockResolvedValue(Buffer.from('[mcp_servers.other]\ncommand="other"\n'));
  await state.commands.get('rea.configureCodex')!();
  expect(state.select).toHaveBeenCalledWith(expect.objectContaining({ canSelectFolders: true, canSelectFiles: false }));
  expect(state.write.mock.calls[0][1].toString()).toContain('[mcp_servers.other]\ncommand="other"');
  expect(state.info).toHaveBeenCalledWith(expect.stringContaining('Extension Development Host does not reload Codex in another window'));
});
it('cancels without reading or writing configuration', async () => {
  registerAgentIntegration({ subscriptions: [] } as any);
  state.select.mockResolvedValueOnce(undefined);
  await state.commands.get('rea.configureCodex')!();
  expect(state.read).not.toHaveBeenCalled(); expect(state.write).not.toHaveBeenCalled();
});
it('blocks untrusted windows and missing executables without writing', async () => {
  registerAgentIntegration({ subscriptions: [] } as any);
  state.trusted = false;
  await state.commands.get('rea.configureCodex')!();
  expect(state.select).not.toHaveBeenCalled();
  state.trusted = true; state.stat.mockRejectedValue(new Error('missing'));
  await state.commands.get('rea.configureCodex')!();
  expect(state.error).toHaveBeenCalledWith(expect.stringContaining('not executable'));
  expect(state.write).not.toHaveBeenCalled();
});
it('refuses unreadable scripts and relative executable paths', async () => {
  await expect(validateCodexLaunch('./node', '/fixture/rea.mjs')).rejects.toThrow('absolute path');
  state.access.mockImplementation(async (file: string) => { if (file === '/fixture/rea.mjs') throw new Error('unreadable'); });
  await expect(validateCodexLaunch('/usr/bin/node', '/fixture/rea.mjs')).rejects.toThrow('unreadable');
});
it('does not overwrite invalid TOML or a concurrently edited file', async () => {
  registerAgentIntegration({ subscriptions: [] } as any);
  state.read.mockResolvedValue(Buffer.from('invalid = ['));
  await state.commands.get('rea.configureCodex')!();
  expect(state.write).not.toHaveBeenCalled();
  state.read.mockResolvedValueOnce(Buffer.from('model="one"')).mockResolvedValueOnce(Buffer.from('model="two"'));
  await state.commands.get('rea.configureCodex')!();
  expect(state.error).toHaveBeenLastCalledWith(expect.stringContaining('configuration changed'));
  expect(state.write).not.toHaveBeenCalled();
});
it('recognizes quoted and dotted REA keys and preserves unrelated servers verbatim', () => {
  for (const text of ['[mcp_servers."rea"]\ncommand="old"', 'mcp_servers.rea.command="old"', "[mcp_servers.'rea'.env]\nX='Y'"]) expect(mergeCodexConfiguration(text, '/node', ['mcp'])).toBeUndefined();
  const text = '# Keep my comments\nmodel="example"\n[mcp_servers.other.env]\nX="Y"\n';
  expect(mergeCodexConfiguration(text, '/node', ['mcp'])).toContain(text);
  expect(() => mergeCodexConfiguration('mcp_servers = { other = { command="keep" } }', '/node', [])).toThrow('safely extended');
});
it('uses the current workspace only as a folder-picker default', async () => {
  registerAgentIntegration({ subscriptions: [] } as any);
  state.folders = [{ uri: '/current-workspace' }];
  state.read.mockResolvedValue(Buffer.from(''));
  await state.commands.get('rea.configureCodex')!();
  expect(state.select).toHaveBeenCalledWith(expect.objectContaining({ defaultUri: '/current-workspace' }));
  expect(state.write.mock.calls[0][0]).toBe('/chosen-project/.codex/config.toml');
});
it('creates a new configuration only when the target is missing', async () => {
  const vscode = await import('vscode');
  registerAgentIntegration({ subscriptions: [] } as any);
  state.read.mockRejectedValue(new vscode.FileSystemError('missing'));
  await state.commands.get('rea.configureCodex')!();
  expect(state.write).toHaveBeenCalledOnce();
  expect(state.write.mock.calls[0][1].toString()).toContain('[mcp_servers.rea]');
});
it('preserves configuration on read failures and when trust is revoked during selection', async () => {
  registerAgentIntegration({ subscriptions: [] } as any);
  state.read.mockRejectedValueOnce(new Error('permission denied'));
  await state.commands.get('rea.configureCodex')!();
  expect(state.write).not.toHaveBeenCalled();
  expect(state.error).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
  state.read.mockResolvedValue(Buffer.from(''));
  state.select.mockImplementationOnce(async () => { state.trusted = false; return [{ scheme: 'file', fsPath: '/chosen-project' }]; });
  await state.commands.get('rea.configureCodex')!();
  expect(state.write).not.toHaveBeenCalled();
});
