import { operationTimeout, protocolErrorCategory, StderrDiagnostics, type OperationTimeouts } from './operationTimeouts';
import { WEB_TOOLS, webArguments, acceptsWebArguments, type WebTool } from '../services/webToolPolicy';
import { READ_ONLY_TOOL, validateReadOnlyArguments } from '../services/readOnlyExecution';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class ReaMcpClient {
  constructor(private readonly timeouts: () => Partial<OperationTimeouts> = () => ({})) {}

  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;

  private operationDiagnostic?: (name: string, outcome: string) => void;
  private connecting = false;
  onDiagnostic?: (message: string) => void;

  private executionSchema: unknown;
  private webSchemas = new Map<string, unknown>();

  // Last complete catalog survives a transport disconnect. Calls still require a live session.
  private catalog: Tool[] = [];
  onDidChangeTools?: () => void;
  onDidDisconnect?: () => void;

  getTools(): readonly Tool[] { return structuredClone(this.catalog); }

  async invokeTool(name: string, input: Record<string, unknown>, options: RequestOptions = {},
    authorize: (tool: Tool, args: Record<string, unknown>) => Promise<boolean>) {
    if (!this.client) throw new Error('REA is not connected.');
    const client = this.client;
    const tool = this.catalog.find(tool => tool.name === name);
    if (!tool) throw new Error('Tool is not in the current REA catalog. Refresh discovery.');
    const args = structuredClone(input);
    if (!await authorize(structuredClone(tool), structuredClone(args))) throw new Error('REA operation was not authorized.');
    if (this.client !== client) throw new Error('REA session changed during authorization.');
    // REA validates its full JSON Schema contract. No argument rewriting or subset validator.
    return client.callTool({ name, arguments: args }, undefined, options);
  }

  async readResource(uri: string, options?: RequestOptions) {
    if (!this.client) throw new Error('REA is not connected.');
    return this.client.readResource({ uri }, options);
  }

  async listResources(cursor?: string, options?: RequestOptions) {
    if (!this.client) throw new Error('REA is not connected.');
    return this.client.listResources(cursor ? { cursor } : undefined, options);
  }

  async connect(command: string, args: string[]): Promise<void> {
    if (this.client || this.connecting) {
      throw new Error('REA is already connected.');
    }

    this.connecting = true;
    const client = new Client({
      name: 'rea-vscode',
      version: '0.4.0'
    });

    const transport = new StdioClientTransport({
      command,
      args,
      stderr: 'pipe',
      // Screenshots can occupy 20M base64 characters, repeated in MCP envelopes.
      // Keep a finite transport budget above the workflow's per-evidence limits.
      maxBufferSize: 64 * 1024 * 1024
    });

    let closed = false;
    let intentional = false;
    let lastOperation = 'none';
    let lastOutcome = 'none';
    let lastFinished: number | undefined;
    const updateOperation = (name: string, outcome: string) => { lastOperation = name; lastOutcome = outcome; lastFinished = Date.now(); };
    this.operationDiagnostic = updateOperation;
    client.onerror = error => this.onDiagnostic?.(`MCP protocol/transport error; category=${protocolErrorCategory(error)}; rawMessage=omitted`);
    const closeTransport = transport.close.bind(transport);
    transport.close = async () => {
      this.onDiagnostic?.(`MCP transport close invoked; lastOperation=${lastOperation}; lastOutcome=${lastOutcome}`);
      await closeTransport();
    };
    // Drain stderr from launch onwards to prevent child-process backpressure.
    // Do not retain or log raw engine output (it may contain target data).
    const stderr = new StderrDiagnostics();
    transport.stderr?.on('data', chunk => stderr.accept(chunk));
    client.onclose = () => {
      closed = true;
      this.onDiagnostic?.(`MCP transport closed; intentional=${intentional || (!this.connecting && this.client !== client)}; ${stderr.summary()}; lastOperation=${lastOperation}; lastOutcome=${lastOutcome}; sinceOperationMs=${lastFinished === undefined ? 'unknown' : Date.now() - lastFinished}`);
      if (this.client === client) {
        this.executionSchema = undefined;
        this.webSchemas.clear();
        this.client = undefined;
        this.transport = undefined;
        this.operationDiagnostic = undefined;
        this.onDidDisconnect?.();
      }
    };

    try {
      await client.connect(transport);

      if (closed) throw new Error('REA transport closed during initialization.');
      this.onDiagnostic?.(`MCP initialized; pid=${transport.pid}`);
      this.client = client;
      this.transport = transport;
      await this.listTools();
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        await this.listTools();
      });
    } catch (error) {
      intentional = true;
      await client.close().catch(() => undefined);
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  async listTools() {
    if (!this.client) {
      throw new Error('REA is not connected.');
    }

    const connectedClient = this.client;
    const tools = [];
    let cursor: string | undefined;
    const seen = new Set<string>();

    do {
      const result = await connectedClient.listTools(
        cursor ? { cursor } : undefined
      );

      tools.push(...result.tools);
      cursor = result.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('REA returned a repeated catalog cursor.');
      if (cursor) seen.add(cursor);
    } while (cursor);

    if (this.client === connectedClient) {
      this.catalog = structuredClone(tools);
      this.onDidChangeTools?.();
      this.webSchemas = new Map(tools.filter(tool => WEB_TOOLS.includes(tool.name as WebTool)).map(tool => [tool.name, tool.inputSchema]));
      this.executionSchema = tools.find(tool => tool.name === READ_ONLY_TOOL)?.inputSchema;
    }
    return tools;
  }

  async executeReadOnlyTool(name: string, input: unknown = {}) {
    const validation = validateReadOnlyArguments(name, this.executionSchema, input);
    if (!validation.ok) throw new Error(validation.error);
    if (!this.client) throw new Error('REA is not connected.');
    return this.client.callTool({ name, arguments: validation.arguments });
  }

  async inspectWebTarget(name: WebTool, endpoint: string, origin: string, id: string | undefined, signal: AbortSignal) {
    if (!WEB_TOOLS.includes(name)) throw new Error('Web operation is not authorized.');
    const args = webArguments(name, endpoint, origin, id);
    if (!acceptsWebArguments(name, this.webSchemas.get(name), args)) throw new Error('Web operation is unavailable or its live schema is unsupported.');
    if (!this.client || signal.aborted) throw new Error('Web inspection is not connected or was cancelled.');
    const started = Date.now();
    const timeout = operationTimeout(name, this.timeouts());
    const updateOperation = this.operationDiagnostic;
    updateOperation?.(name, 'running');
    this.onDiagnostic?.(`Web operation started: ${name}; timeoutMs=${timeout}`);
    try {
      const result = await this.client.callTool({ name, arguments: args }, undefined, { timeout, maxTotalTimeout: timeout, resetTimeoutOnProgress: false, signal });
      updateOperation?.(name, result.isError === true ? 'tool-error' : 'success');
      this.onDiagnostic?.(`Web operation completed: ${name}; toolError=${result.isError === true}; elapsedMs=${Date.now() - started}`);
      return result;
    } catch (error) {
      const outcome = signal.aborted ? 'cancelled' : error instanceof Error && 'code' in error && error.code === -32001 ? 'timeout' : 'request-error';
      updateOperation?.(name, outcome);
      this.onDiagnostic?.(`Web operation failed: ${name}; cancelled=${signal.aborted}; connected=${this.isConnected()}; elapsedMs=${Date.now() - started}; outcome=${outcome}; cancellationNotification=${outcome === 'timeout' || outcome === 'cancelled'}`);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connecting) throw new Error('Cannot disconnect while REA is connecting.');
    const client = this.client;
    this.onDiagnostic?.('MCP disconnect requested explicitly.');

    this.executionSchema = undefined;
    this.webSchemas.clear();
    this.client = undefined;
    this.transport = undefined;

    if (client) {
      await client.close();
    }
  }

  isConnected(): boolean {
    return this.client !== undefined;
  }
}
