import { reconstructionAgentPrompt } from '../analysis/agentHandoff';
import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Prepare an explicit, reviewable coding-agent handoff.
 * No code is generated automatically: the user chooses their agent and submits
 * the prompt in the newly opened project window.
 */
export async function openReconstructionInAgent(projectPath: string): Promise<string> {
  if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before generating with AI.');
  const root = path.resolve(projectPath);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error('The reconstruction project directory is missing.');
  const required = ['reconstruction-brief.md', 'evidence.json', 'index.html', 'styles.css'];
  for (const name of required) {
    const file = path.join(root, name);
    const info = await fs.stat(file).catch(() => undefined);
    if (!info?.isFile()) throw new Error(`Missing required project file: ${name}`);
  }
  const choice = await vscode.window.showInformationMessage(
    'REA will open the reconstruction project in a new VS Code window and copy an AI-agent prompt to your clipboard. Paste it into Copilot Chat (Agent mode) or your preferred coding agent. Your clipboard will be replaced.',
    { modal: true }, 'Open project and copy prompt'
  );
  if (choice !== 'Open project and copy prompt') return 'Generate with AI cancelled.';
  await vscode.env.clipboard.writeText(reconstructionAgentPrompt);
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), { forceNewWindow: true });
  return 'Project opened in a new VS Code window. Prompt copied: open your coding agent and paste it to begin. No code has been generated yet.';
}
