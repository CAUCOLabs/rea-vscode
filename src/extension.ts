import { initializeEngineRuntime, resolveEngineLaunch } from './services/engineRuntime';
import { registerSetup } from './services/setup';
import * as vscode from 'vscode';
import { launchConfiguration, registerAgentIntegration } from './services/agentIntegration';

import { ReaMcpClient } from './mcp/client';
import { ConnectionManager } from './services/connectionManager';
import { ReaSidebarProvider } from './views/reaSidebarProvider';
import { redact } from './views/sidebarProtocol';

const rea = new ReaMcpClient(() => {
  const config = vscode.workspace.getConfiguration('rea');
  return { webOperationTimeoutMs: config.get<number>('webOperationTimeoutMs'), bundleAnalysisTimeoutMs: config.get<number>('bundleAnalysisTimeoutMs') };
});
const connectionManager = new ConnectionManager(rea);

let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  initializeEngineRuntime(context.extensionUri.fsPath);
  registerAgentIntegration(context);
  registerSetup(context, async () => {
    if (connectionManager.isConnected()) await connectionManager.disconnect();
    await vscode.commands.executeCommand('rea.connect', true);
    if (!connectionManager.isConnected()) return false;
    await rea.listTools();
    return true;
  });
  output = vscode.window.createOutputChannel('REA');

  rea.onDiagnostic = message => output.appendLine(`[${new Date().toISOString()}] ${String(redact(message))}`);
  connectionManager.onDidChange(() => output.appendLine(`MCP state: ${connectionManager.getState()}`));
  output.appendLine('REA for VS Code activated.');

  const sidebar = new ReaSidebarProvider(context.extensionUri, rea, connectionManager);
  context.subscriptions.push(
    sidebar,
    vscode.window.registerWebviewViewProvider('rea.sidebar', sidebar)
  );

  const connectCommand = vscode.commands.registerCommand(
    'rea.connect',
    async (quiet = false) => {
      try {
        if (!vscode.workspace.isTrusted) {
          output.appendLine(
            'REA MCP server launch blocked: workspace is not trusted.'
          );
          vscode.window.showWarningMessage(
            'REA MCP server execution is disabled in untrusted workspaces. Trust this workspace before connecting.'
          );
          return;
        }

        if (connectionManager.isConnected()) {
          vscode.window.showInformationMessage(
            'REA is already connected.'
          );
          return true;
        }

        const config = vscode.workspace.getConfiguration('rea');

        const scriptPath = config.get<string>('scriptPath', '').trim();
        const executable = config.get<string>('executable', 'node').trim();

        const { command, args } = await resolveEngineLaunch(executable, scriptPath);

        output.appendLine('Connecting to REA MCP server.');

        const connect = async () => {
          if (!vscode.workspace.isTrusted) throw new Error('Workspace is not trusted.');
          await connectionManager.connect(command, args);
        };
        if (quiet === true) await connect();
        else await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Starting REA…',
            cancellable: false
          },
          async () => {
            if (!vscode.workspace.isTrusted) {
              output.appendLine(
                'REA MCP server launch blocked: workspace is not trusted.'
              );
              throw new Error(
                'REA MCP server execution is disabled in untrusted workspaces.'
              );
            }

            await connectionManager.connect(command, args);
          }
        );

        output.appendLine('REA MCP connection established.');

        if (quiet !== true) vscode.window.showInformationMessage(
          'REA is ready.'
        );
        return true;
      } catch (error) {
        rea.onDiagnostic?.(`Connect failed: ${error instanceof Error ? error.message : String(error)}`);
        const message = 'Unable to connect. Check Workspace Trust, the REA executable, and the absolute script path in user settings.';

        output.appendLine(`Connection error: ${message}`);
        if (quiet !== true) output.show(true);

        if (quiet !== true) {
          const action = await vscode.window.showErrorMessage('REA could not start. Run setup to install or select a compatible Node.js runtime.', 'Set up REA');
          if (action === 'Set up REA') await vscode.commands.executeCommand('rea.setup');
        }
        return false;
      }
    }
  );

  const listToolsCommand = vscode.commands.registerCommand(
    'rea.listTools',
    async () => {
      try {
        const tools = await rea.listTools();

        output.appendLine('');
        output.appendLine(`REA MCP tools discovered: ${tools.length}`);
        output.appendLine('--------------------------------');

        for (const tool of tools) {
          output.appendLine(String(redact(tool.name)));
        }

        output.show(true);

        vscode.window.showInformationMessage(
          `REA: ${tools.length} MCP tools discovered.`
        );
      } catch {
        vscode.window.showErrorMessage(
          'REA tool discovery failed. Check the connection and retry.'
        );
      }
    }
  );

  const invokeCommand = vscode.commands.registerCommand('rea.invokeTool', async () => {
    try {
      if (!vscode.workspace.isTrusted) throw new Error('Workspace is not trusted.');
      const tools = await rea.listTools();
      const selected = await vscode.window.showQuickPick(tools.map(tool => ({ label: tool.name, description: tool.description })), { title: 'REA full engine: select a tool' });
      if (!selected) return;
      const input = await vscode.window.showInputBox({ title: `Arguments for ${selected.label}`, prompt: 'JSON object matching the complete live input schema in Tool Explorer', value: '{}' });
      if (input === undefined) return;
      const args: unknown = JSON.parse(input);
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be a JSON object.');
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: selected.label, cancellable: true }, async (_, token) => {
        const controller = new AbortController();
        const subscription = token.onCancellationRequested(() => controller.abort());
        try {
          return await rea.invokeTool(selected.label, args as Record<string, unknown>, { signal: controller.signal, timeout: 300_000 }, async (tool, values) => {
            if (!vscode.workspace.isTrusted) return false;
            const approved = await vscode.window.showWarningMessage(`Run REA ${tool.name}? Review target paths and side effects.`, { modal: true, detail: JSON.stringify(values, null, 2) }, 'Run');
            return approved === 'Run' && vscode.workspace.isTrusted;
          });
        } finally { subscription.dispose(); }
      });
      // Keep the complete MCP envelope, including structuredContent, images and resource links.
      const document = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(result, null, 2) });
      await vscode.window.showTextDocument(document);
    } catch (error) { void vscode.window.showErrorMessage(`REA: ${String(redact(error instanceof Error ? error.message : String(error)))}`); }
  });

  const disconnectCommand = vscode.commands.registerCommand(
    'rea.disconnect',
    async () => {
      try {
        await connectionManager.disconnect();

        output.appendLine('REA MCP server disconnected.');

        vscode.window.showInformationMessage(
          'REA disconnected.'
        );
      } catch {
        vscode.window.showErrorMessage(
          'REA disconnect failed. Reload the extension host before reconnecting.'
        );
      }
    }
  );

  context.subscriptions.push(
    invokeCommand,
    connectCommand,
    listToolsCommand,
    disconnectCommand,
    output
  );
}

export async function deactivate() {
  await connectionManager.disconnect();
}
