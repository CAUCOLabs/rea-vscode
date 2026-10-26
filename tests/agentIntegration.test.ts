import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ trusted: true, documents: [] as any[], provider: undefined as any, commands: new Map<string, Function>(), read: vi.fn(), copy: vi.fn(), warning: vi.fn(), write: vi.fn(), changed: vi.fn(), folders: undefined as any, select: vi.fn(), error: vi.fn(), info: vi.fn(), stat: vi.fn(), access: vi.fn() }));
vi.mock('node:fs/promises', () => ({ stat: state.stat, access: state.access }));
vi.mock('vscode', () => ({
  FileType: { Directory: 2 },
  EventEmitter: class { event = state.changed; fire() {} dispose() {} },
  FileSystemError: class extends Error { code = 'FileNotFound'; },
  McpStdioServerDefinition: class { constructor(public label: string, public command: string, public args: string[], public env: unknown, public version: string) {} },
  lm: { registerMcpServerDefinitionProvider: (_: string, provider: unknown) => { state.provider = provider; return { dispose() {} }; } },
  workspace: {
    get textDocuments() { return state.documents; },
    get isTrusted() { return state.trusted; },
    getConfiguration: () => ({ get: (key: string) => key === 'executable' ? process.execPath : '' }),
    onDidChangeConfiguration: () => ({ dispose() {} }), onDidGrantWorkspaceTrust: () => ({ dispose() {} }),
    get workspaceFolders() { return state.folders; },
    fs: { stat: vi.fn(async () => ({ type: 2 })), readFile: state.read, writeFile: state.write, copy: state.copy, createDirectory: vi.fn() },
    openTextDocument: vi.fn(async (x: unknown) => x)
  },
  commands: { registerCommand: (key: string, callback: Function) => { state.commands.set(key, callback); return { dispose() {} }; } },
  Uri: { joinPath: (...parts: string[]) => parts.map(p => typeof p === 'string' ? p : (p as any).fsPath).join('/') },
  window: { showOpenDialog: state.select, showErrorMessage: state.error, showTextDocument: vi.fn(), showInformationMessage: state.info, showWarningMessage: state.warning }
}));
import { codexConfiguration, launchConfiguration, mergeCodexConfiguration, validateCodexLaunch, registerAgentIntegration, configureCopilot, mergeCopilotConfiguration } from '../src/services/agentIntegration';
import { initializeEngineRuntime } from '../src/services/engineRuntime';
beforeEach(() => { vi.clearAllMocks(); state.warning.mockReset(); state.copy.mockReset(); state.read.mockReset(); state.write.mockReset(); initializeEngineRuntime('/extension'); state.trusted = true; state.documents = []; state.commands.clear(); state.folders = undefined; state.select.mockResolvedValue([{ scheme: 'file', fsPath: '/chosen-project' }]); state.stat.mockResolvedValue({ isFile: () => true }); state.access.mockResolvedValue(undefined); });
it('provides the real engine with no catalog proxy or allowlist and enforces trust', () => {
  registerAgentIntegration({ subscriptions: [], asAbsolutePath: (p: string) => '/extension/' + p } as any);
  const definitions = state.provider.provideMcpServerDefinitions();
  expect(definitions[0]).toMatchObject({ command: process.execPath, args: ['/extension/runtime/rea/scripts/rea.mjs','--mcp'] });
  expect(definitions[1]).toMatchObject({ command: process.execPath, args: ['/extension/dist/browserServer.js'], env: {} });
  expect(definitions[2]).toMatchObject({ command: process.execPath, args: ['/extension/dist/routerServer.js', '/extension/runtime/rea/scripts/rea.mjs'], env: {} });
  state.trusted = false;
  expect(state.provider.provideMcpServerDefinitions()).toEqual([]);
  expect(() => state.provider.resolveMcpServerDefinition(definitions[0])).toThrow('trusted');
});
it('resolves native MCP definitions to the packaged engine and an absolute Node runtime', async () => {
  registerAgentIntegration({ subscriptions: [], asAbsolutePath: (p: string) => '/extension/' + p } as any);
  const definition = state.provider.provideMcpServerDefinitions()[0];
  const resolved = await state.provider.resolveMcpServerDefinition(definition);
  expect(resolved.command).toBe(process.execPath);
  expect(resolved.args).toEqual(['/extension/runtime/rea/scripts/rea.mjs', '--mcp']);
});
it('writes separate Codex project configuration while retaining existing settings', async () => {
  registerAgentIntegration({ subscriptions: [], asAbsolutePath: (p: string) => '/extension/' + p } as any);
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
  registerAgentIntegration({ subscriptions: [], asAbsolutePath: (p: string) => '/extension/' + p } as any);
  state.read.mockResolvedValue(Buffer.from('[mcp_servers.rea]\ncommand = "existing"\n[mcp_servers.rea_browser]\ncommand = "browser"\n'));
  await state.commands.get('rea.configureCodex')!(); expect(state.write).not.toHaveBeenCalled();
});
it('validates launch paths and escapes Codex values', () => {
  expect(() => launchConfiguration('node','relative')).toThrow('absolute');
  expect(codexConfiguration('C:\\node.exe', ['a"b'])).toContain('C:\\\\node.exe');
});
it('selects a folder in an empty Extension Host and explains which Codex must reload', async () => {
  registerAgentIntegration({ subscriptions: [], asAbsolutePath: (p: string) => '/extension/' + p } as any);
  state.read.mockResolvedValue(Buffer.from('[mcp_servers.other]\ncommand="other"\n'));
  await state.commands.get('rea.configureCodex')!();
  expect(state.select).toHaveBeenCalledWith(expect.objectContaining({ canSelectFolders: true, canSelectFiles: false }));
  expect(state.write.mock.calls[0][1].toString()).toContain('[mcp_servers.other]\ncommand="other"');
  expect(state.info).toHaveBeenCalledWith(expect.stringContaining('Extension Development Host does not reload Codex in another window'));
});
it('cancels without reading or writing configuration', async () => {
  registerAgentIntegration({ subscriptions: [], asAbsolutePath: (p: string) => '/extension/' + p } as any);
  state.select.mockResolvedValueOnce(undefined);
  await state.commands.get('rea.configureCodex')!();
  expect(state.read).not.toHaveBeenCalled(); expect(state.write).not.toHaveBeenCalled();
});
it('blocks untrusted windows and missing executables without writing', async () => {
  registerAgentIntegration({ subscriptions: [], asAbsolutePath: (p: string) => '/extension/' + p } as any);
  state.trusted = false;
  await state.commands.get('rea.configureCodex')!();
  expect(state.select).not.toHaveBeenCalled();
  state.trusted = true; state.stat.mockRejectedValue(new Error('missing'));
  await expect(validateCodexLaunch(process.execPath, '')).rejects.toThrow('not executable');
  expect(state.write).not.toHaveBeenCalled();
});
it('refuses unreadable scripts and relative executable paths', async () => {
  await expect(validateCodexLaunch('./node', '/fixture/rea.mjs')).rejects.toThrow('absolute path');
  state.access.mockImplementation(async (file: string) => { if (file === '/fixture/rea.mjs') throw new Error('unreadable'); });
  await expect(validateCodexLaunch('/usr/bin/node', '/fixture/rea.mjs')).rejects.toThrow('unreadable');
});
it('does not overwrite invalid TOML or a concurrently edited file', async () => {
  registerAgentIntegration({ subscriptions: [], asAbsolutePath: (p: string) => '/extension/' + p } as any);
  state.read.mockResolvedValue(Buffer.from('invalid = ['));
  await state.commands.get('rea.configureCodex')!();
  expect(state.write).not.toHaveBeenCalled();
  state.read.mockResolvedValueOnce(Buffer.from('model="one"')).mockResolvedValueOnce(Buffer.from('model="two"'));
  await state.commands.get('rea.configureCodex')!();
  expect(state.error).toHaveBeenLastCalledWith(expect.stringContaining('configuration changed'));
  expect(state.write).not.toHaveBeenCalled();
});
it('recognizes quoted and dotted REA keys and preserves unrelated servers verbatim', () => {
  for (const text of ['[mcp_servers."rea"]\ncommand="old"', 'mcp_servers.rea.command="old"', "[mcp_servers.'rea'.env]\nX='Y'"]) expect(mergeCodexConfiguration(text, '/node', ['--mcp'])).toBeUndefined();
  const text = '# Keep my comments\nmodel="example"\n[mcp_servers.other.env]\nX="Y"\n';
  expect(mergeCodexConfiguration(text, '/node', ['--mcp'])).toContain(text);
  expect(() => mergeCodexConfiguration('mcp_servers = { other = { command="keep" } }', '/node', [])).toThrow('safely extended');
});
it('uses the current workspace only as a folder-picker default', async () => {
  registerAgentIntegration({ subscriptions: [], asAbsolutePath: (p: string) => '/extension/' + p } as any);
  state.folders = [{ uri: '/current-workspace' }];
  state.read.mockResolvedValue(Buffer.from(''));
  await state.commands.get('rea.configureCodex')!();
  expect(state.select).toHaveBeenCalledWith(expect.objectContaining({ defaultUri: '/current-workspace' }));
  expect(state.write.mock.calls[0][0]).toBe('/chosen-project/.codex/config.toml');
});
it('creates a new configuration only when the target is missing', async () => {
  const vscode = await import('vscode');
  registerAgentIntegration({ subscriptions: [], asAbsolutePath: (p: string) => '/extension/' + p } as any);
  state.read.mockRejectedValue(new vscode.FileSystemError('missing'));
  await state.commands.get('rea.configureCodex')!();
  expect(state.write).toHaveBeenCalledOnce();
  expect(state.write.mock.calls[0][1].toString()).toContain('[mcp_servers.rea]');
});
it('preserves configuration on read failures and when trust is revoked during selection', async () => {
  registerAgentIntegration({ subscriptions: [], asAbsolutePath: (p: string) => '/extension/' + p } as any);
  state.read.mockRejectedValueOnce(new Error('permission denied'));
  await state.commands.get('rea.configureCodex')!();
  expect(state.write).not.toHaveBeenCalled();
  expect(state.error).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
  state.read.mockResolvedValue(Buffer.from(''));
  state.select.mockImplementationOnce(async () => { state.trusted = false; return [{ scheme: 'file', fsPath: '/chosen-project' }]; });
  await state.commands.get('rea.configureCodex')!();
  expect(state.write).not.toHaveBeenCalled();
});
it('adds the browser companion when REA already exists without rewriting it', async () => {
  const { mergeAgentConfiguration } = await import('../src/services/agentIntegration');
  const existing = '# retain\n[mcp_servers.rea]\ncommand="custom-rea"\n';
  const result = mergeAgentConfiguration(existing, '/rea-node', ['/rea-cli','--mcp'], '/extension/dist/browserServer.js', '/node');
  expect(result).toContain(existing);
  expect(result).toContain('[mcp_servers.rea_browser]\ncommand = "/node"');
  expect(result).not.toContain('ELECTRON_RUN_AS_NODE');
  expect(mergeAgentConfiguration(result!, '/rea-node', [], '/new-path')).toBeUndefined();
});

it('uses the packaged engine by default instead of resolving packages with npx', () => {
  expect(launchConfiguration(process.execPath, '')).toMatchObject({ args: ['/extension/runtime/rea/scripts/rea.mjs', '--mcp'] });
});
it('uses an installed Node and the installed extension bundle for browser configuration', async () => {
  const { mergeAgentConfiguration } = await import('../src/services/agentIntegration');
  const result = mergeAgentConfiguration('', '/node', ['/engine/rea.mjs','--mcp'], '/installed extension/dist/browserServer.js', '/node', '/browser with spaces/chrome');
  expect(result).toContain('command = "/node"');
  expect(result).toContain('--browser-executable');
  expect(result).toContain('/browser with spaces/chrome');
  expect(result).not.toContain('ELECTRON_RUN_AS_NODE');
});


it('merges portable Copilot configuration without filtering the full engine catalog', () => {
  const result = JSON.parse(mergeCopilotConfiguration('{"other":true,"mcpServers":{"keep":{"command":"custom"}}}', '/node', ['/rea.mjs', '--mcp'])!);
  expect(result).toEqual({ other: true, mcpServers: { keep: { command: 'custom' }, rea: { command: '/node', args: ['/rea.mjs', '--mcp'] } } });
  expect(mergeCopilotConfiguration('{"mcpServers":{"rea":{"command":"custom"}}}', '/node', [])).toBeUndefined();
  for (const invalid of ['[]', 'null', '{"mcpServers":[]}', '{"mcpServers":null}', '{']) expect(() => mergeCopilotConfiguration(invalid, '/node', [])).toThrow();
});
it('writes Copilot portable configuration in the actual project and detects concurrent edits', async () => {
  state.folders = [{ uri: { scheme: 'file', fsPath: '/project' } }];
  state.read.mockResolvedValue(Buffer.from('{"mcpServers":{"keep":{"command":"custom"}}}'));
  await configureCopilot();
  expect(state.write.mock.calls[0][0]).toBe('/project/.mcp.json');
  expect(JSON.parse(state.write.mock.calls[0][1].toString()).mcpServers.rea.args).toEqual(['/extension/runtime/rea/scripts/rea.mjs', '--mcp']);
  state.write.mockClear();
  state.read.mockResolvedValueOnce(Buffer.from('{}')).mockResolvedValueOnce(Buffer.from('{"changed":true}'));
  await expect(configureCopilot()).rejects.toThrow('configuration changed');
  expect(state.write).not.toHaveBeenCalled();
  state.trusted = false;
  await expect(configureCopilot()).rejects.toThrow('trusted');
});

it('preserves existing Copilot REA entries and rejects folderless sessions', async () => {
  await expect(configureCopilot()).rejects.toThrow('local project folder');
  expect(state.write).not.toHaveBeenCalled();
  state.folders = [{ uri: { scheme: 'file', fsPath: '/project' } }];
  state.read.mockResolvedValue(Buffer.from('{"mcpServers":{"rea":{"command":"keep"}}}'));
  await configureCopilot();
  expect(state.write).not.toHaveBeenCalled();
  expect(state.info).toHaveBeenCalledWith(expect.stringContaining('preserved'));
});

const updateAction = 'Update REA MCP configuration';
const legacy = '# project comment\nmodel = "keep"\n\n[mcp_servers.rea]\ncommand = "/old/node" # launch\nargs = ["/old/rea.mjs", "--mcp", "--custom"]\ntool_timeout_sec = 777\nenabled_tools = ["custom_tool"]\n\n[mcp_servers.rea_browser]\ncommand = "/old/electron"\nargs = ["/old/browser.js"]\nenv = { ELECTRON_RUN_AS_NODE = "1", CUSTOM = "keep" }\n\n# untouched server\n[mcp_servers.other]\ncommand = "other"\nargs = ["leave", "these"]\n';
const registerCodex = () => {
  registerAgentIntegration({ subscriptions: [], asAbsolutePath: (p: string) => '/extension/' + p } as any);
  return state.commands.get('rea.configureCodex')!;
};

it('migrates only after acceptance, using the resolved Node and installed extension paths with a verified backup', async () => {
  const run = registerCodex();
  state.read.mockResolvedValue(Buffer.from(legacy));
  state.warning.mockResolvedValue(updateAction);
  await run();
  expect(state.warning).toHaveBeenCalledWith(expect.stringContaining('existing REA'),
    expect.objectContaining({ modal: true, detail: expect.stringContaining('including custom launch arguments') }), updateAction);
  expect(state.copy).toHaveBeenCalledWith('/chosen-project/.codex/config.toml',
    expect.stringMatching(/^\/chosen-project\/\.codex\/config\.toml\.rea-backup-[a-f0-9-]+$/), { overwrite: false });
  expect(state.write).toHaveBeenCalledOnce();
  expect(state.copy.mock.invocationCallOrder[0]).toBeLessThan(state.write.mock.invocationCallOrder[0]);
  const updated = state.write.mock.calls[0][1].toString();
  const { parse } = await import('smol-toml');
  const servers = parse(updated).mcp_servers as any;
  expect(servers.rea.command).toBe(process.execPath);
  expect(servers.rea.args).toEqual(['/extension/runtime/rea/scripts/rea.mjs', '--mcp']);
  expect(servers.rea_browser.command).toBe(process.execPath);
  expect(servers.rea_browser.args).toEqual(['/extension/dist/browserServer.js']);
  expect(servers.rea_browser.env).toEqual({ CUSTOM: 'keep' });
  expect(servers.rea.tool_timeout_sec).toBe(777);
  expect(servers.rea.enabled_tools).toEqual(['custom_tool']);
  expect(updated).toContain('# project comment\nmodel = "keep"\n');
  expect(updated).toContain(' # launch\n');
  expect(updated.slice(updated.indexOf('# untouched server'))).toBe(legacy.slice(legacy.indexOf('# untouched server')));
});

it.each([undefined, 'Cancel'])('leaves legacy configuration untouched when migration is cancelled (%j)', async answer => {
  const run = registerCodex();
  state.read.mockResolvedValue(Buffer.from(legacy));
  state.warning.mockResolvedValue(answer);
  await run();
  expect(state.warning).toHaveBeenCalledOnce();
  expect(state.copy).not.toHaveBeenCalled();
  expect(state.write).not.toHaveBeenCalled();
});

it('does not prompt or write when existing REA launch entries are current, retaining custom settings', async () => {
  const { mergeAgentConfiguration } = await import('../src/services/agentIntegration');
  const current = mergeAgentConfiguration('', process.execPath, ['/extension/runtime/rea/scripts/rea.mjs', '--mcp'], '/extension/dist/browserServer.js', process.execPath)!;
  const run = registerCodex();
  state.read.mockResolvedValue(Buffer.from(current.replace('tool_timeout_sec = 300', 'tool_timeout_sec = 999')));
  await run();
  expect(state.warning).not.toHaveBeenCalled();
  expect(state.copy).not.toHaveBeenCalled();
  expect(state.write).not.toHaveBeenCalled();
  expect(state.info).toHaveBeenCalledWith(expect.stringContaining('already current'));
});

it.each(['invalid = [', 'mcp_servers = { rea = { command = "old", args = [] }, rea_browser = { command = "old", args = [] } }'])('preserves invalid or unsupported TOML without offering an unsafe update: %s', async text => {
  const run = registerCodex();
  state.read.mockResolvedValue(Buffer.from(text));
  state.warning.mockResolvedValue(updateAction);
  await run();
  expect(state.warning).not.toHaveBeenCalled();
  expect(state.copy).not.toHaveBeenCalled();
  expect(state.write).not.toHaveBeenCalled();
  expect(state.error).toHaveBeenCalledWith(expect.stringContaining('Review the TOML syntax and REA tables manually'));
});

it('detects edits during confirmation and before backup creation', async () => {
  const run = registerCodex();
  state.read.mockResolvedValueOnce(Buffer.from(legacy)).mockResolvedValue(Buffer.from(legacy + '# concurrent edit\n'));
  state.warning.mockResolvedValue(updateAction);
  await run();
  expect(state.copy).not.toHaveBeenCalled();
  expect(state.write).not.toHaveBeenCalled();
  expect(state.error).toHaveBeenCalledWith(expect.stringContaining('configuration changed'));
});

it('detects edits after creating the backup and does not write over them', async () => {
  const run = registerCodex();
  state.read.mockResolvedValueOnce(Buffer.from(legacy)) // original
    .mockResolvedValueOnce(Buffer.from(legacy)) // before backup
    .mockResolvedValueOnce(Buffer.from(legacy)) // backup verification
    .mockResolvedValueOnce(Buffer.from(legacy + '# edit during backup\n'));
  state.warning.mockResolvedValue(updateAction);
  await run();
  expect(state.copy).toHaveBeenCalledOnce();
  expect(state.write).not.toHaveBeenCalled();
  expect(state.error).toHaveBeenCalledWith(expect.stringContaining('configuration changed'));
});

it.each(['copy fails', 'backup differs'])('preserves configuration if the backup cannot be verified: %s', async failure => {
  const run = registerCodex();
  state.warning.mockResolvedValue(updateAction);
  state.read.mockResolvedValue(Buffer.from(legacy));
  if (failure === 'copy fails') state.copy.mockRejectedValueOnce(new Error('backup permission denied'));
  else state.read.mockResolvedValueOnce(Buffer.from(legacy)).mockResolvedValueOnce(Buffer.from(legacy))
    .mockResolvedValueOnce(Buffer.from('wrong backup'));
  await run();
  expect(state.write).not.toHaveBeenCalled();
  expect(state.error).toHaveBeenCalledWith(expect.stringContaining('Codex backup failed'));
});

it('backs up an existing file when adding new REA entries without changing the new-configuration flow', async () => {
  const run = registerCodex();
  state.read.mockResolvedValue(Buffer.from('# existing project\nmodel = "keep"\n'));
  await run();
  expect(state.warning).not.toHaveBeenCalled();
  expect(state.copy).toHaveBeenCalledOnce();
  expect(state.write).toHaveBeenCalledOnce();
});

it('does not normalize invalid UTF-8 into a writable configuration', async () => {
  const run = registerCodex();
  state.read.mockResolvedValue(Buffer.from([0xff, 0xfe]));
  await run();
  expect(state.copy).not.toHaveBeenCalled();
  expect(state.write).not.toHaveBeenCalled();
  expect(state.error).toHaveBeenCalledWith(expect.stringContaining('not valid UTF-8'));
});

it('migrates quoted/dotted keys and nested tables while preserving unrelated text byte for byte', async () => {
  const { migrateCodexLaunches } = await import('../src/services/codexMigration');
  const { parse } = await import('smol-toml');
  const unrelated = '# untouched\r\nmodel = "example"\r\ntext = """\n[mcp_servers.rea]\ncommand = "fake" # not syntax\n"""\r\n';
  const text = unrelated + '"mcp_servers".\'rea\'.command = "old" # command comment\r\nmcp_servers.rea.args = [\r\n "old", # array comment\r\n "--custom"\r\n]\r\n[mcp_servers."rea".env]\r\nKEEP = \'custom\'\r\n"ELECTRON_RUN_AS_NODE" = "1"\r\n[mcp_servers.\'rea_browser\']\r\ncommand = "old"\r\nargs = []\r\n[mcp_servers.rea_browser.env]\r\nELECTRON_RUN_AS_NODE = "1"\r\nTOKEN = "unchanged"\r\n\r\n[mcp_servers.other]\r\ncommand = "keep"\r\n';
  const result = migrateCodexLaunches(text, '/bundled/node', ['/bundled/rea', '--mcp'], ['/extension/browser.js'])!;
  expect(result.startsWith(unrelated)).toBe(true);
  expect(result).toContain(' # command comment\r\n');
  expect(result.slice(result.indexOf('[mcp_servers.other]'))).toBe(text.slice(text.indexOf('[mcp_servers.other]')));
  const servers = parse(result).mcp_servers as any;
  expect(servers.rea.args).toEqual(['/bundled/rea', '--mcp']);
  expect(servers.rea.env).toEqual({ KEEP: 'custom' });
  expect(servers.rea_browser.env).toEqual({ TOKEN: 'unchanged' });
});

it.each([
  '{ ELECTRON_RUN_AS_NODE="1", KEEP="a,b" }',
  '{ KEEP="a,b", ELECTRON_RUN_AS_NODE="1" }',
  '{ ELECTRON_RUN_AS_NODE="1" }',
  '{ A="one", ELECTRON_RUN_AS_NODE="1", B="two" }'
])('removes only the confirmed Electron environment field from %s', async env => {
  const { migrateCodexLaunches } = await import('../src/services/codexMigration');
  const { parse } = await import('smol-toml');
  const text = `[mcp_servers.rea_browser]\ncommand="old"\nargs=[]\nenv=${env} # retain\n`;
  const result = migrateCodexLaunches(text, '/node', ['/rea', '--mcp'], ['/browser'])!;
  const before = (parse(text).mcp_servers as any).rea_browser.env;
  delete before.ELECTRON_RUN_AS_NODE;
  expect((parse(result).mcp_servers as any).rea_browser.env).toEqual(before);
  expect(result).toContain(' # retain\n');
});

it('fills missing launch fields in explicit or implicit REA tables without discarding custom values', async () => {
  const { migrateCodexLaunches } = await import('../src/services/codexMigration');
  const { parse } = await import('smol-toml');
  for (const text of ['[mcp_servers.rea]\ncustom="keep"\n', '[mcp_servers.rea.env]\nCUSTOM="keep"\n']) {
    const result = migrateCodexLaunches(text, '/node', ['/rea', '--mcp'], ['/browser'])!;
    const rea = (parse(result).mcp_servers as any).rea;
    expect(rea.command).toBe('/node');
    expect(rea.args).toEqual(['/rea', '--mcp']);
    expect(text.includes('.env]') ? rea.env.CUSTOM : rea.custom).toBe('keep');
  }
});

it('does not overwrite unsaved configuration editor contents', async () => {
  const run = registerCodex();
  state.read.mockResolvedValue(Buffer.from(legacy));
  state.warning.mockResolvedValue(updateAction);
  state.documents = [{ isDirty: true, uri: '/chosen-project/.codex/config.toml' }];
  await run();
  expect(state.copy).not.toHaveBeenCalled();
  expect(state.write).not.toHaveBeenCalled();
  expect(state.error).toHaveBeenCalledWith(expect.stringContaining('unsaved editor changes'));
});

it('requires confirmation when adding the missing browser companion alongside an existing REA entry', async () => {
  const run = registerCodex();
  state.read.mockResolvedValue(Buffer.from('[mcp_servers.rea]\ncommand="custom"\nargs=[]\n'));
  state.warning.mockResolvedValue(undefined);
  await run();
  expect(state.warning).toHaveBeenCalledOnce();
  expect(state.copy).not.toHaveBeenCalled();
  expect(state.write).not.toHaveBeenCalled();
});

it('fills missing dotted launch fields without redeclaring their implicit parent table', async () => {
  const { migrateCodexLaunches } = await import('../src/services/codexMigration');
  const { parse } = await import('smol-toml');
  for (const text of ['mcp_servers.rea.command = "old"\n', '[mcp_servers]\n"rea".command = "old"\n']) {
    const result = migrateCodexLaunches(text, '/node', ['/rea'], ['/browser'])!;
    expect((parse(result).mcp_servers as any).rea).toEqual({ command: '/node', args: ['/rea'] });
  }
});

it('preserves an empty environment table when removing its only dotted Electron key', async () => {
  const { migrateCodexLaunches } = await import('../src/services/codexMigration');
  const { parse } = await import('smol-toml');
  const result = migrateCodexLaunches('mcp_servers.rea.command="old"\nmcp_servers.rea.args=[]\nmcp_servers.rea.env.ELECTRON_RUN_AS_NODE="1"\n', '/node', ['/rea'], ['/browser'])!;
  expect((parse(result).mcp_servers as any).rea.env).toEqual({});
});
