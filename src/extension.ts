import * as vscode from 'vscode';
import * as path from 'node:path';

import { ReaMcpClient } from './mcp/client';
import { ConnectionManager } from './services/connectionManager';
import { ReaSidebarProvider } from './views/reaSidebarProvider';
import { redact } from './views/sidebarProtocol';

const rea = new ReaMcpClient();
const connectionManager = new ConnectionManager(rea);

let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('REA');

  output.appendLine('REA for VS Code activated.');

  const sidebar = new ReaSidebarProvider(context.extensionUri, rea, connectionManager);
  context.subscriptions.push(
    sidebar,
    vscode.window.registerWebviewViewProvider('rea.sidebar', sidebar)
  );

  const connectCommand = vscode.commands.registerCommand(
    'rea.connect',
    async () => {
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
          return;
        }

        const config = vscode.workspace.getConfiguration('rea');

        const scriptPath = config.get<string>('scriptPath', '').trim();
        const executable = config.get<string>('executable', 'node').trim();

        if (!executable) {
          throw new Error('REA executable cannot be empty.');
        }

        if (scriptPath && !path.isAbsolute(scriptPath)) {
          throw new Error('REA scriptPath must be an absolute path.');
        }

        const command = scriptPath ? executable : 'npx';
        const args = scriptPath
          ? [scriptPath, 'mcp']
          : ['--no-install', 'rea-agents', 'mcp'];

        output.appendLine('Connecting to REA MCP server.');

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Connecting to REA MCP server...',
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

        vscode.window.showInformationMessage(
          'REA MCP server connected successfully.'
        );
      } catch {
        const message = 'Unable to connect. Check Workspace Trust, the REA executable, and the absolute script path in user settings.';

        output.appendLine(`Connection error: ${message}`);
        output.show(true);

        vscode.window.showErrorMessage(
          `REA connection failed: ${message}`
        );
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
    connectCommand,
    listToolsCommand,
    disconnectCommand,
    output
  );
}

export async function deactivate() {
  await connectionManager.disconnect();
}
