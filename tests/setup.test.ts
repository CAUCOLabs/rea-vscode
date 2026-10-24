import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ trusted: true, commands: new Map<string, Function>(), input: vi.fn(), dialog: vi.fn(), pick: vi.fn(), update: vi.fn(), exec: vi.fn(), browser: vi.fn(), configureCopilot: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: (command: string, args: string[], options: unknown, callback: Function) => { state.exec(command, args, options); callback(null, args[0] === '-p' ? JSON.stringify({ version: 'v24.11.0', execPath: '/installed/node', node: true }) : 'v24.11.0', ''); } }));
vi.mock('../src/services/agentIntegration', () => ({ configureCopilot: state.configureCopilot }));
vi.mock('../src/services/analysisBrowser', () => ({ findBrowserExecutable: state.browser }));
vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1 },
  workspace: { get isTrusted() { return state.trusted; }, getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback, update: state.update }) },
  window: { showInputBox: state.input, showOpenDialog: state.dialog, showQuickPick: state.pick, showInformationMessage: state.info, showErrorMessage: state.error },
  commands: { registerCommand: (name: string, callback: Function) => { state.commands.set(name, callback); return { dispose() {} }; }, executeCommand: vi.fn() }
}));
import { installationDiagnostics, registerSetup } from '../src/services/setup';
import { initializeEngineRuntime } from '../src/services/engineRuntime';
beforeEach(() => {
  vi.clearAllMocks(); initializeEngineRuntime(process.cwd()); state.trusted = true; state.commands.clear();
  state.configureCopilot.mockResolvedValue({ command: '/installed/node', args: ['/engine/rea.mjs', '--mcp'] });
  state.browser.mockResolvedValue('/installed/chrome');
});
it('blocks diagnostics and setup before launching software in an untrusted workspace', async () => {
  state.trusted = false;
  await expect(installationDiagnostics()).rejects.toThrow('Trust');
  registerSetup({ subscriptions: [] } as any, vi.fn());
  await state.commands.get('rea.setup')!();
  expect(state.exec).not.toHaveBeenCalled(); expect(state.input).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
});
it('cancels setup without changing machine settings or executing a process', async () => {
  registerSetup({ subscriptions: [] } as any, vi.fn());
  state.input.mockResolvedValueOnce(undefined);
  await state.commands.get('rea.setup')!();
  expect(state.update).not.toHaveBeenCalled(); expect(state.exec).not.toHaveBeenCalled();
});
it('saves resolved machine paths and verifies only after the user chooses verification', async () => {
  const verify = vi.fn(async () => true);
  registerSetup({ subscriptions: [] } as any, verify);
  state.input.mockResolvedValueOnce('node');
  state.pick.mockResolvedValueOnce('Detect installed browser').mockResolvedValueOnce('Done');
  state.info.mockResolvedValueOnce('Verify connection');
  await state.commands.get('rea.setup')!();
  expect(state.update).toHaveBeenCalledWith('executable', 'node', 1);
  expect(state.update).not.toHaveBeenCalledWith('scriptPath', expect.anything(), expect.anything());
  expect(state.exec).toHaveBeenCalledWith('/installed/node', ['--version'], expect.objectContaining({ shell: false, timeout: 5000 }));
  expect(verify).toHaveBeenCalledOnce();
});
it('reports a failed engine handshake without claiming successful verification', async () => {
  registerSetup({ subscriptions: [] } as any, async () => false);
  await state.commands.get('rea.diagnostics')!();
  expect(state.error).toHaveBeenCalledWith(expect.stringContaining('handshake failed'));
  expect(state.info).not.toHaveBeenCalled();
});

it('configures the Copilot harness instead of merely opening the editor server list', async () => {
  registerSetup({ subscriptions: [] } as any, vi.fn());
  await state.commands.get('rea.configureCopilot')!();
  expect(state.configureCopilot).toHaveBeenCalledOnce();
  expect(state.exec).not.toHaveBeenCalled();
});
