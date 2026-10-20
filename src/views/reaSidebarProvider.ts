import { createReconstructionProject } from '../analysis/reconstructionProject';
import * as vscode from 'vscode';
import { presentAnalysis } from '../analysis/analysisPresentation';
import { startAnalysisBrowser, AnalysisBrowserError, type BrowserLease } from '../services/analysisBrowser';
import { analyzeWebTarget, reconstructionSpec, exportWebReport, type WebReport } from '../analysis/webTargetAnalyzer';
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
  private autoConnectAttempted = false;
  private browser?: BrowserLease;
  private analysisReport?: WebReport;
  private analysisController?: AbortController;
  private generation = 0;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: ReaMcpClient,
    private readonly manager: ConnectionManager
  ) {
    this.subscriptions.push(manager.onDidChange(() => {
      if (manager.getState() !== 'connected') {
        const retainPartial = manager.getState() === 'disconnected' && this.analysisController && !this.analysisController.signal.aborted;
        if (this.analysisController && !retainPartial) {
          this.analysisController.abort();
          void this.browser?.close().catch(() => undefined);
          this.send({ type: 'analysisProgress', percent: 0, message: 'The connection changed. Reconnect and try analyzing again.' });
        }
        if (!retainPartial) this.generation++;
        this.tools = [];
        this.send({ type: 'tools', tools: [] });
        this.send({ type: 'result', text: '' });
      }
      this.updateStatus();
    }));
    this.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => {
      this.updateStatus();
      if (this.view && !this.autoConnectAttempted) void this.receive({ type: 'ready' });
    }));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = randomBytes(24).toString('hex');
    const analyzerScript = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'webAnalyzer.js'));
    const model = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebarModel.js'));
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.js'));
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.css'));
    view.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none';">
<link rel="stylesheet" href="${style}"><title>REA</title></head><body>
<header class="brand"><span class="brand-mark" aria-hidden="true">R</span><div><h1>REA</h1><p>Understand a website.<br>Plan your own implementation.</p></div></header>
<button id="open-setup">Set up REA</button><div class="connection-row"><span id="connection-indicator" role="status">Starting REA…</span><button id="reconnect" class="text-button" hidden>Reconnect</button></div>
<section id="web-analyzer" aria-label="Analyze an application">
<fieldset class="target-picker"><legend>What would you like to explore?</legend><div class="target-options">
<button id="target-web" class="target-option" aria-pressed="true">Web</button><button id="target-github" class="target-option" aria-pressed="false">GitHub<span>Coming soon</span></button><button id="target-desktop" class="target-option" aria-pressed="false">Desktop App<span>Coming soon</span></button>
</div></fieldset><p id="coming-soon" class="hint" hidden></p>
<label for="target-url" class="input-label">Website URL</label><input id="target-url" aria-describedby="analysis-progress" type="url" placeholder="https://example.com" autocomplete="off" spellcheck="false">
<button id="analyze-target" class="primary-action" disabled>Analyze</button>
<div class="progress-area"><p id="analysis-progress" role="status">Getting ready…</p><progress id="analysis-meter" value="0" max="100" aria-label="Analysis progress" hidden></progress></div>
<section id="analysis-results" hidden aria-label="Your analysis"><div class="result-heading"><h2 id="analysis-status">Your analysis</h2><span class="result-badge">Website snapshot</span></div>
<p id="report-target" class="hint"></p><p id="report-readiness"></p>
<div class="result-card"><h3>Identified components</h3><ul id="component-summary"></ul></div>
<div class="result-card"><h3>Observed interactions</h3><p class="hint">Available controls; behavior has not been tested.</p><ul id="interaction-summary"></ul></div>
<div class="result-card"><h3>Resources and technologies</h3><ul id="resource-summary"></ul></div>
<div class="result-card"><h3>Missing information</h3><ul id="missing-summary"></ul></div>
<div class="result-actions"><button id="view-analysis" aria-expanded="false">View Analysis</button><button id="export-report" disabled>Export Report</button><button id="prepare-reconstruction" disabled>Prepare Reconstruction</button></div>
<button id="create-reconstruction" hidden disabled>Create Reconstruction Project</button><p id="preparation-status" role="status"></p><section id="analysis-detail-panel" hidden aria-label="Analysis details"><h3>Analysis details</h3><div id="screenshot-preview"></div><div id="human-findings"></div></section>
</section></section>
<details id="advanced-explorer"><summary>Advanced / Developer Tools</summary>
<p id="status" role="status">Disconnected</p><div class="actions"><button id="connect">Connect</button><button id="disconnect" disabled>Disconnect</button><button id="refresh" disabled>Refresh tools</button></div><p id="notice" role="status"></p>
<details><summary>Browser connection details</summary><p>REA creates a dedicated temporary browser for each analysis. Personal profiles and arbitrary endpoints are never attached.</p><label for="cdp-endpoint">Managed connection</label><input id="cdp-endpoint" readonly value="Not running"></details>
<details><summary>Evidence and diagnostics</summary><p id="evidence-summary">No analysis yet.</p><div id="analysis-findings"></div></details>
<details><summary>Coding brief preview</summary><pre id="reconstruction-spec">Prepare a reconstruction brief after analyzing.</pre></details><details><summary>Tool Explorer</summary><section class="navigation" aria-label="Tool navigation"><label for="search">Search tools</label><input id="search" type="search" placeholder="Name or description">
<div class="actions navigation-controls"><button id="expand-all">Expand All</button><button id="collapse-all">Collapse All</button></div><p id="count"></p><p class="hint">Grouped by literal name prefix, not by permissions.</p><div id="tools" aria-label="Tools" tabindex="0"></div></section>
<section id="detail" hidden><h3 id="name"></h3><details id="tool-description"><summary>Description</summary><p id="description"></p></details><h4>Input parameters</h4><div id="parameters"></div><details><summary>Raw JSON Schema</summary><pre id="schema"></pre></details>
<p id="execution-policy" class="hint"></p><p id="parameter-error" role="alert"></p><button id="execute" hidden disabled>Run read-only query</button><p class="hint">Only list_unknowns is authorized. Page size is limited to 100; omitted offset/limit use 0/50. Parameters are not persisted.</p></section></details>
<h3>Result</h3><p id="result-status" role="status">No result yet.</p><div id="result"></div><details id="original-section" hidden><summary>Original MCP response (redacted; output limit applies)</summary><pre id="original-response"></pre></details>
</details><script nonce="${nonce}" src="${model}"></script><script nonce="${nonce}" src="${script}"></script><script nonce="${nonce}" src="${analyzerScript}"></script></body></html>`;
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
      if (this.analysisReport) this.send({ type: 'analysisReport', report: this.analysisReport, presentation: presentAnalysis(this.analysisReport) });
      // A newly created view has no catalog, even if the host is already connected.
      if (!this.manager.isConnected() && (!vscode.workspace.isTrusted || this.autoConnectAttempted)) return;
    }
    if (this.busy) return;
    this.busy = true;
    this.updateStatus();
    this.send({ type: 'notice', text: '' });
    const operationGeneration = this.generation;
    try {
      switch (message.type) {
        case 'ready':
          if (!this.manager.isConnected()) {
            this.autoConnectAttempted = true;
            await vscode.commands.executeCommand('rea.connect', true);
          }
          if (this.manager.isConnected()) await this.refresh();
          break;
        case 'refresh': await this.refresh(); break;
        case 'connect':
          this.autoConnectAttempted = true;
          await vscode.commands.executeCommand('rea.connect', true);
          if (this.manager.isConnected()) await this.refresh();
          break;
        case 'disconnect': await vscode.commands.executeCommand('rea.disconnect'); break;
        case 'analyzeWebTarget': {
          if (!vscode.workspace.isTrusted || !this.manager.isConnected()) {
            this.send({ type: 'analysisProgress', percent: 0, message: 'Trust this workspace and reconnect to REA before analyzing.' });
            break;
          }
          this.analysisReport = undefined;
          this.send({ type: 'analysisReset' });
          const controller = new AbortController();
          this.analysisController = controller;
          try {
            if (!this.tools.length) await this.refresh();
            if (!this.tools.some(tool => tool.name === 'inspect_web_page') || !this.tools.some(tool => tool.name === 'list_browser_targets')) throw new AnalysisBrowserError('Your REA installation needs web analysis support. Open REA Settings in Advanced to check the installation.');
            const allowed = () => vscode.workspace.isTrusted && this.manager.isConnected() && this.generation === operationGeneration;
            this.send({ type: 'analysisProgress', percent: 5, message: 'Preparing a separate analysis browser…' });
            const browser = await startAnalysisBrowser({ url: message.url, signal: controller.signal, allowed, executablePath: vscode.workspace.getConfiguration('rea').get<string>('browserPath', '') });
            this.browser = browser;
            this.send({ type: 'browserDetails', endpoint: browser.endpoint });
            const report = await analyzeWebTarget({
              target: browser.target, endpoint: browser.endpoint, tools: this.tools.map(tool => tool.name), client: this.client,
              signal: controller.signal,
              allowed: () => vscode.workspace.isTrusted && this.manager.isConnected() && this.generation === operationGeneration,
              progress: percent => this.send({ type: 'analysisProgress', percent, message: ({ 10: 'Reading the website…', 30: 'Identifying page elements…', 65: 'Reviewing resources and technologies…', 90: 'Preparing your report…', 100: 'Your report is ready to review.' } as Record<number, string>)[percent] ?? 'Analyzing the website…' })
            });
            if (browser.target !== new URL(message.url).href) {
              report.findings.push({ id: `F${report.findings.length + 1}`, classification: 'UNKNOWN', area: 'Redirect', detail: 'The website changed address while loading. Only the final page was inspected; redirect and authentication behavior were not tested.', source: 'managed analysis browser', evidenceId: 'not captured', path: 'final browser URL' });
              report.specification = reconstructionSpec(report);
              report.markdown = exportWebReport(report);
            }
            if (!controller.signal.aborted && this.generation === operationGeneration && vscode.workspace.isTrusted) {
              this.analysisReport = report;
              this.send({ type: 'analysisReport', report, presentation: presentAnalysis(report) });
            }
          } catch (error) {
            this.client.onDiagnostic?.(`Analysis failed; connected=${this.manager.isConnected()}; cancelled=${controller.signal.aborted}; ${error instanceof Error ? error.message : 'unknown error'}`);
            this.send({ type: 'analysisProgress', percent: 0, message: error instanceof AnalysisBrowserError ? error.message : 'We could not finish this analysis. Check the website address and try again. Setup details are available in Advanced.' });
          } finally {
            this.analysisController = undefined;
            const browser = this.browser;
            this.browser = undefined;
            if (browser) {
              try { await browser.close(); this.client.onDiagnostic?.(`Analysis browser closed; MCP connected=${this.manager.isConnected()}`); this.send({ type: 'browserDetails', endpoint: 'Analysis browser closed' }); }
              catch (error) { this.send({ type: 'analysisProgress', percent: 0, message: error instanceof AnalysisBrowserError ? error.message : 'The analysis browser could not close. Close it before starting another analysis.' }); }
            }
          }
          break;
        }
        case 'openSetup': await vscode.commands.executeCommand('rea.setup'); break;
        case 'prepareReconstruction': {
          if (!this.analysisReport || !vscode.workspace.isTrusted || !presentAnalysis(this.analysisReport).canPrepare) break;
          this.analysisReport.specification = reconstructionSpec(this.analysisReport);
          this.analysisReport.markdown = exportWebReport(this.analysisReport);
          this.send({ type: 'reconstructionPrepared', specification: this.analysisReport.specification });
          break;
        }
        case 'createReconstructionProject': {
          const report = this.analysisReport;
          if (!report || !vscode.workspace.isTrusted || !presentAnalysis(report).canPrepare) break;
          const selection = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Choose parent folder' });
          if (!selection?.[0] || !vscode.workspace.isTrusted) break;
          try {
            const destination = await createReconstructionProject(selection[0].fsPath, report, `rea-reconstruction-${randomBytes(6).toString('hex')}`);
            this.send({ type: 'projectCreated', message: `Starter project created: ${destination}. Open index.html. Controls and backend remain unverified.` });
          } catch {
            this.send({ type: 'projectCreated', message: 'Project creation failed. Existing files were not overwritten. Choose a writable folder and retry.' });
          }
          break;
        }
        case 'exportWebReport': {
          const report = this.analysisReport;
          if (!report || !vscode.workspace.isTrusted) break;
          const base = vscode.workspace.workspaceFolders?.[0]?.uri ?? this.extensionUri;
          const destination = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.joinPath(base, 'rea-web-analysis.md'),
            filters: { Markdown: ['md'] }, saveLabel: 'Export report'
          });
          if (destination && this.analysisReport === report && vscode.workspace.isTrusted) {
            await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(report.markdown));
            this.send({ type: 'analysisProgress', percent: 100, message: 'Markdown report exported. Review redaction before sharing with a coding agent.' });
          }
          break;
        }

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
      if (message.type === 'exportWebReport') this.send({ type: 'analysisProgress', percent: 100, message: 'Markdown export failed. Choose a writable destination and retry.' });
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
    this.analysisController?.abort();
    void this.browser?.close().catch(() => undefined);
    this.analysisReport = undefined;
    for (const item of this.subscriptions) item.dispose();
    this.view = undefined;
    this.tools = [];
  }
}
