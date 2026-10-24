import { beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const state = vi.hoisted(() => ({ trusted: true, choice: vi.fn(), clipboard: vi.fn(), command: vi.fn() }));
vi.mock('vscode', () => ({
  workspace: { get isTrusted() { return state.trusted; } },
  window: { showInformationMessage: state.choice },
  env: { clipboard: { writeText: state.clipboard } },
  commands: { executeCommand: state.command },
  Uri: { file: (path: string) => ({ fsPath: path }) }
}));
import { openReconstructionInAgent } from '../src/services/reconstructionAgent';
import { reconstructionAgentPrompt } from '../src/analysis/agentHandoff';
beforeEach(() => { vi.clearAllMocks(); state.trusted = true; state.choice.mockResolvedValue('Open project and copy prompt'); });
it('hands off the persistent evidence prompt to the chosen agent without generating application code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rea-agent-handoff-'));
  try {
    for (const name of ['reconstruction-brief.md','evidence.json','index.html','styles.css']) await writeFile(join(root,name), 'fixture');
    expect(await openReconstructionInAgent(root)).toContain('No code has been generated yet');
    expect(state.clipboard).toHaveBeenCalledWith(reconstructionAgentPrompt);
    expect(state.command).toHaveBeenCalledWith('vscode.openFolder', { fsPath: root }, { forceNewWindow: true });
    expect(reconstructionAgentPrompt).toContain('scenario-evidence.json');
    expect(reconstructionAgentPrompt).toContain('evidence/viewport.png');
    state.clipboard.mockClear(); state.command.mockClear(); state.choice.mockResolvedValue(undefined);
    expect(await openReconstructionInAgent(root)).toContain('cancelled');
    expect(state.clipboard).not.toHaveBeenCalled(); expect(state.command).not.toHaveBeenCalled();
    state.trusted = false;
    await expect(openReconstructionInAgent(root)).rejects.toThrow('Trust');
  } finally { await rm(root, {recursive:true,force:true}); }
});
it('rejects incomplete project artifacts before replacing the clipboard or opening a window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rea-agent-missing-'));
  try {
    await expect(openReconstructionInAgent(root)).rejects.toThrow('Missing required');
    expect(state.clipboard).not.toHaveBeenCalled(); expect(state.command).not.toHaveBeenCalled();
  } finally { await rm(root, {recursive:true,force:true}); }
});
