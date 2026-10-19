import { WEB_TOOLS, webArguments, acceptsWebArguments, type WebTool } from '../services/webToolPolicy';
import { READ_ONLY_TOOL, validateReadOnlyArguments } from '../services/readOnlyExecution';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class ReaMcpClient {
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;

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
    if (this.client) {
      throw new Error('REA is already connected.');
    }

    const client = new Client({
      name: 'rea-vscode',
      version: '0.1.0'
    });

    const transport = new StdioClientTransport({
      command,
      args,
      stderr: 'pipe'
    });

    client.onclose = () => {
      if (this.client === client) {
        this.executionSchema = undefined;
        this.webSchemas.clear();
        this.client = undefined;
        this.transport = undefined;
        this.onDidDisconnect?.();
      }
    };

    try {
      await client.connect(transport);

      this.client = client;
      this.transport = transport;
      await this.listTools();
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        await this.listTools();
      });
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
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
    return this.client.callTool({ name, arguments: args }, undefined, { timeout: 20_000, maxTotalTimeout: 25_000, signal });
  }

  async disconnect(): Promise<void> {
    const client = this.client;

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
