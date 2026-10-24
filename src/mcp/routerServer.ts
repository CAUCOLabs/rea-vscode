import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import path from 'node:path';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ToolListChangedNotificationSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';

const MAX_SEARCH_RESULTS = 25;
const EXECUTION_TIMEOUT_MS = 300_000;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function createRouterServer(upstream: Client) {
  const server = new Server({ name: 'rea-universal-router', version: '0.4.0' }, {
    capabilities: { tools: {} },
    instructions: 'Search the complete REA catalog, retrieve the exact live schema, then execute a selected REA tool with its arguments. REA tool calls are forwarded unchanged. Execution can have side effects; review and approve every rea_execute_tool call in your MCP client.'
  });
  let catalog: Tool[] = [];

  const discover = async () => {
    const next: Tool[] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await upstream.listTools(cursor ? { cursor } : undefined);
      next.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('REA returned a repeated catalog cursor.');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    catalog = next;
  };

  const toolDefinitions: Tool[] = [
    { name: 'rea_search_tools', description: 'Search REA tools by name, description, or capability keywords. Returns a bounded list of matching names and descriptions.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 500 }, limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS } }, required: ['query'], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'rea_get_tool_schema', description: 'Return the exact current REA tool definition and input schema for a tool name.', inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 256 } }, required: ['name'], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'rea_execute_tool', description: 'Execute a selected REA tool with its arguments. This forwards the original tool call and response unchanged. Tool calls may have side effects; inspect the tool schema and arguments, then approve this call in your MCP client.', inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 256 }, arguments: { type: 'object', additionalProperties: true } }, required: ['name', 'arguments'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } }
  ];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
    const args = params.arguments ?? {};
    if (!isRecord(args)) throw new Error('Arguments must be an object.');
      if (params.name === 'rea_search_tools') {
        if (Object.keys(args).some(key => !['query', 'limit'].includes(key)) || typeof args.query !== 'string' || !args.query.trim() || args.query.length > 500 || (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > MAX_SEARCH_RESULTS))) throw new Error('Invalid rea_search_tools arguments.');
        if (!catalog.length) await discover();
        const query = (args.query as string).trim().toLocaleLowerCase();
        const limit = (args.limit as number | undefined) ?? 15;
        const matches = catalog.filter(tool => `${tool.name} ${tool.description ?? ''}`.toLocaleLowerCase().includes(query)).slice(0, limit);
        return { content: [{ type: 'text', text: JSON.stringify({ totalTools: catalog.length, matchCount: matches.length, results: matches.map(({ name, description }) => ({ name, description })) }) }], structuredContent: { totalTools: catalog.length, matchCount: matches.length, results: matches.map(({ name, description }) => ({ name, description })) } };
      }
      if (params.name === 'rea_get_tool_schema') {
        if (Object.keys(args).length !== 1 || typeof args.name !== 'string' || !args.name) throw new Error('Invalid rea_get_tool_schema arguments.');
        if (!catalog.length) await discover();
        const tool = catalog.find(entry => entry.name === args.name);
        if (!tool) throw new Error('REA tool not found. Search the current catalog and retry.');
        return { content: [{ type: 'text', text: JSON.stringify(tool) }], structuredContent: tool as unknown as Record<string, unknown> };
      }
      if (params.name === 'rea_execute_tool') {
        if (Object.keys(args).length !== 2 || typeof args.name !== 'string' || !args.name || !isRecord(args.arguments)) throw new Error('Invalid rea_execute_tool arguments.');
        if (!catalog.length) await discover();
        if (!catalog.some(tool => tool.name === args.name)) throw new Error('REA tool not found in the current catalog. Search and retrieve its schema before execution.');
        // The upstream REA engine remains the authority for schema validation and permissions.
        // MCP clients see this router tool as non-read-only, so each call requires their normal approval.
        return await upstream.callTool({ name: args.name, arguments: args.arguments }, undefined, { signal: extra.signal, timeout: EXECUTION_TIMEOUT_MS, maxTotalTimeout: EXECUTION_TIMEOUT_MS, resetTimeoutOnProgress: false });
      }
      throw new Error('Unknown router tool.');
  });
  upstream.setNotificationHandler(ToolListChangedNotificationSchema, async () => { await discover(); });
  return { server, discover, getCatalog: () => catalog };
}

export async function runRouterServer(engineScript: string) {
  if (!engineScript || !path.isAbsolute(engineScript)) throw new Error('Router requires an absolute REA engine script path.');
  const upstream = new Client({ name: 'rea-universal-router-upstream', version: '0.4.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [engineScript, '--mcp'], stderr: 'pipe', maxBufferSize: 64 * 1024 * 1024 });
  const stderr = transport.stderr;
  stderr?.on('data', () => { /* Drain engine diagnostics without retaining target data. */ });
  await upstream.connect(transport);
  const router = createRouterServer(upstream);
  let closing: Promise<void> | undefined;
  const close = () => closing ??= Promise.allSettled([router.server.close(), upstream.close()]).then(() => undefined);
  const stop = () => { void close().catch(error => { console.error(error); process.exitCode = 1; }); };
  router.server.onclose = stop;
  upstream.onclose = stop;
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.stdin.once('end', stop);
  await router.server.connect(new StdioServerTransport());
}
