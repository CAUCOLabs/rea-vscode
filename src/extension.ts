import * as vscode from 'vscode';
import * as path from 'node:path';

import { ReaMcpClient } from './mcp/client';

const rea = new ReaMcpClient();

let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('REA');

  output.appendLine('REA for VS Code activated.');

  const connectCommand = vscode.commands.registerCommand(
    'rea.connect',
    async () => {
      try {
        if (rea.isConnected()) {
          vscode.window.showInformationMessage(
            'REA is already connected.'
          );
          return;
        }

        const config = vscode.workspace.getConfiguration('rea');

        let scriptPath = config.get<string>('scriptPath', '');

        if (!scriptPath) {
          scriptPath = path.resolve(
            context.extensionPath,
            '../rea/scripts/rea.mjs'
          );
        }

        output.appendLine(`Connecting to REA: ${scriptPath}`);

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Connecting to REA MCP server...',
            cancellable: false
          },
          async () => {
            await rea.connect(scriptPath);
          }
        );

        output.appendLine('REA MCP connection established.');

        vscode.window.showInformationMessage(
          'REA MCP server connected successfully.'
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

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
          output.appendLine(tool.name);
        }

        output.show(true);

        vscode.window.showInformationMessage(
          `REA: ${tools.length} MCP tools discovered.`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `REA tool discovery failed: ${String(error)}`
        );
      }
    }
  );

  const disconnectCommand = vscode.commands.registerCommand(
    'rea.disconnect',
    async () => {
      try {
        await rea.disconnect();

        output.appendLine('REA MCP server disconnected.');

        vscode.window.showInformationMessage(
          'REA disconnected.'
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `REA disconnect failed: ${String(error)}`
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
  await rea.disconnect();
}
