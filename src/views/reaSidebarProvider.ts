import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { ReaMcpClient } from '../mcp/client';
import { executionEditor, validateReadOnlyArguments } from '../services/readOnlyExecution';
import type { ConnectionManager } from '../services/connectionManager';
import { parseSidebarMessage, READ_ONLY_TOOL, redact, resultText } from './sidebarProtocol';

type Tool = Awaited<ReturnType<ReaMcpClient['listTools']>>[number];

export class ReaSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private tools: Tool[] = [];
  private busy = false;
  private generation = 0;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: ReaMcpClient,
    private readonly manager: ConnectionManager
  ) {
    this.subscriptions.push(manager.onDidChange(() => {
      if (manager.getState() !== 'connected') {
        this.generation++;
        this.tools = [];
        this.send({ type: 'tools', tools: [] });
        this.send({ type: 'result', text: '' });
      }
      this.updateStatus();
    }));
    this.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => this.updateStatus()));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = randomBytes(24).toString('hex');
    const model = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebarModel.js'));
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.js'));
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.css'));
    view.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none';">
<link rel="stylesheet" href="${style}"><title>REA Explorer</title></head><body>
<h2>REA Explorer</h2><p id="status" role="status">Disconnected</p>
<div class="actions"><button id="connect">Connect</button><button id="disconnect" disabled>Disconnect</button><button id="refresh" disabled>Refresh tools</button></div>
<p id="notice" role="status"></p>
<section class="navigation" aria-label="Tool navigation"><label for="search">Search tools</label><input id="search" type="search" placeholder="Name or description">
<div class="actions navigation-controls"><button id="expand-all">Expand All</button><button id="collapse-all">Collapse All</button></div><p id="count"></p><p class="hint">Grouped by literal name prefix, not by permissions.</p><div id="tools" aria-label="Tools" tabindex="0"></div></section>
<section id="detail" hidden><h3 id="name"></h3><details id="tool-description"><summary>Description</summary><p id="description"></p></details><h4>Input parameters</h4><div id="parameters"></div><details><summary>Raw JSON Schema</summary><pre id="schema"></pre></details>
<p id="execution-policy" class="hint"></p><p id="parameter-error" role="alert"></p><button id="execute" hidden disabled>Run read-only query</button><p class="hint">Only list_unknowns is authorized. Page size is limited to 100; omitted offset/limit use 0/50. Parameters are not persisted.</p></section>
<h3>Result</h3><p id="result-status" role="status">No result yet.</p><div id="result"></div><details id="original-section" hidden><summary>Original MCP response (redacted; output limit applies)</summary><pre id="original-response"></pre></details>
<script nonce="${nonce}" src="${model}"></script><script nonce="${nonce}" src="${script}"></script></body></html>`;
    const receiver = view.webview.onDidReceiveMessage((message: unknown) => { void this.receive(message); });
    const disposal = view.onDidDispose(() => {
      receiver.dispose();
      if (this.view === view) this.view = undefined;
    });
    this.subscriptions.push(receiver, disposal);
  }

  private send(message: object): void { void this.view?.webview.postMessage(message); }

  updateStatus(): void {
    this.send({ type: 'status', state: this.manager.getState(), trusted: vscode.workspace.isTrusted, busy: this.busy });
  }

  private async refresh(): Promise<void> {
    if (!vscode.workspace.isTrusted || !this.manager.isConnected()) return;
    const generation = this.generation;
    const tools = await this.client.listTools();
    if (generation !== this.generation || !this.manager.isConnected() || !vscode.workspace.isTrusted) return;
    this.tools = tools;
    this.send({ type: 'tools', tools: tools.map(tool => {
      const editor = executionEditor(tool.name, tool.inputSchema);
      return {
        name: redact(tool.name), description: redact(tool.description ?? ''), inputSchema: redact(tool.inputSchema),
        executable: tool.name === READ_ONLY_TOOL, editor: redact(editor)
      };
    }) });
  }

  private async receive(value: unknown): Promise<void> {
    const message = parseSidebarMessage(value);
    if (!message) return;
    if (message.type === 'ready') {
      this.updateStatus();
      // A newly created view has no catalog, even if the host is already connected.
      if (!this.manager.isConnected()) return;
    }
    if (this.busy) return;
    this.busy = true;
    this.updateStatus();
    this.send({ type: 'notice', text: '' });
    const operationGeneration = this.generation;
    try {
      switch (message.type) {
        case 'ready': case 'refresh': await this.refresh(); break;
        case 'connect':
          await vscode.commands.executeCommand('rea.connect');
          if (this.manager.isConnected()) await this.refresh();
          break;
        case 'disconnect': await vscode.commands.executeCommand('rea.disconnect'); break;
        case 'execute': {
          if (!vscode.workspace.isTrusted || !this.manager.isConnected()) {
            this.send({ type: 'notice', text: 'A trusted workspace and an active connection are required.' });
            return;
          }
          const tool = this.tools.find(tool => tool.name === READ_ONLY_TOOL);
          if (!tool) {
            this.send({ type: 'notice', text: 'The read-only tool is not available in the current catalog.' });
            return;
          }
          const validation = validateReadOnlyArguments(READ_ONLY_TOOL, tool.inputSchema, message.arguments);
          if (!validation.ok) {
            this.send({ type: 'notice', text: validation.error });
            return;
          }
          const generation = this.generation;
          this.send({ type: 'result', text: '', pending: true });
          const result = await this.client.executeReadOnlyTool(READ_ONLY_TOOL, validation.arguments);
          if (generation === this.generation && this.manager.isConnected() && vscode.workspace.isTrusted) {
            this.send({ type: 'result', text: resultText(result), isError: result.isError === true });
            this.send({ type: 'notice', text: result.isError ? 'REA returned a tool error. See the result.' : 'Read-only query completed.' });
          }
          break;
        }
      }
    } catch {
      if (message.type === 'execute' && operationGeneration === this.generation && this.manager.isConnected() && vscode.workspace.isTrusted) {
        this.send({ type: 'result', text: resultText({ isError: true, content: [{ type: 'text', text: 'REA query failed. Check the connection and retry.' }] }), isError: true });
      }
      this.send({ type: 'notice', text: 'REA operation failed. Check the connection and server configuration, then retry.' });
    } finally {
      this.busy = false;
      this.updateStatus();
    }
  }

  dispose(): void {
    for (const item of this.subscriptions) item.dispose();
    this.view = undefined;
    this.tools = [];
  }
}
