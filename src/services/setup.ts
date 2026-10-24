import { resolveEngineLaunch, detectRuntime, runtimeHelp } from './engineRuntime';
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { configureCopilot } from './agentIntegration';
import { findBrowserExecutable } from './analysisBrowser';

export async function installationDiagnostics() {
  if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before verifying executable software.');
  const config = vscode.workspace.getConfiguration('rea');
  const launch = await resolveEngineLaunch(config.get('executable', 'node'), config.get('scriptPath', ''));
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(launch.command, ['--version'], { timeout: 5000, maxBuffer: 4096, shell: false }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  const version = stdout.trim();
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || !(Number(match[1]) >= 26 || Number(match[1]) === 24 && Number(match[2]) >= 11 || Number(match[1]) === 22 && Number(match[2]) >= 19)) throw new Error('Use a Node.js version supported by your REA engine (REA 6.7: ^22.19, ^24.11 or >=26).');
  const browser = await findBrowserExecutable(config.get('browserPath', ''));
  return { launch, version, browser };
}

export function registerSetup(context: vscode.ExtensionContext, verifyConnection: () => Promise<boolean | { toolsDiscovered: number; tool: string; invocation: unknown }>) {
  const failure = (error: unknown) => vscode.window.showErrorMessage(`REA setup: ${error instanceof Error ? error.message : 'Verification failed.'}`);
  const verify = async () => {
    const result = await installationDiagnostics();
    const engine = await verifyConnection();
    if (!engine) throw new Error('Engine handshake failed. Check the REA output and engine dependencies, then retry.');
    await vscode.window.showInformationMessage(`REA connection verified. Node ${result.version}. ${result.browser ? 'Installed browser located.' : 'No compatible browser found; configure rea.browserPath for website analysis.'}`);
    return { ...result, engine };
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('rea.diagnostics', async () => { try { return await verify(); } catch (error) { await failure(error); } }),
    vscode.commands.registerCommand('rea.configureCopilot', async () => {
      try {
        await configureCopilot();
      } catch (error) { await failure(error); }
    }),
    vscode.commands.registerCommand('rea.setup', async () => {
      try {
        if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before setting up REA.');
        const config = vscode.workspace.getConfiguration('rea');
        const node = await vscode.window.showInputBox({ title: 'REA setup — Node.js', prompt: 'The extension includes Node.js 26.8.1. Leave this as “node” to use it; enter a compatible executable only to override the bundled runtime.', value: config.get('executable', 'node') });
        if (node === undefined) return;
        const command = await detectRuntime(node);
        const browserChoice = await vscode.window.showQuickPick(['Detect installed browser', 'Select browser executable'], { title: 'REA setup — Chrome, Chromium or Edge' });
        if (!browserChoice) return;
        let browserPath = '';
        if (browserChoice === 'Select browser executable') {
          const selected = await vscode.window.showInputBox({ title: 'Absolute browser executable path', prompt: 'On macOS select the binary inside the .app/Contents/MacOS directory.', value: config.get('browserPath', '') });
          if (selected === undefined) return;
          if (!selected.trim()) throw new Error('Browser executable path cannot be empty.');
          browserPath = selected.trim();
          await findBrowserExecutable(browserPath);
        }
        if (!vscode.workspace.isTrusted) throw new Error('Workspace is no longer trusted.');
        await config.update('executable', node.trim() === 'node' ? 'node' : command, vscode.ConfigurationTarget.Global);
        await config.update('browserPath', browserPath, vscode.ConfigurationTarget.Global);
        const action = await vscode.window.showInformationMessage('Paths saved. Verify runs your selected Node and REA engine; only use software you trust.', 'Verify connection');
        if (action !== 'Verify connection') return;
        await verify();
        const agent = await vscode.window.showQuickPick(['Done', 'Configure Codex', 'Configure Copilot'], { title: 'REA ready — optional coding agent integration' });
        if (agent === 'Configure Codex') await vscode.commands.executeCommand('rea.configureCodex');
        if (agent === 'Configure Copilot') await vscode.commands.executeCommand('rea.configureCopilot');
      } catch (error) { await failure(error); }
    })
  );
}
