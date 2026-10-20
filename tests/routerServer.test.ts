import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createRouterServer } from '../src/mcp/routerServer';

async function connectedRouter(upstream: Record<string, any>) {
  const { server } = createRouterServer(upstream as any);
  const client = new Client({ name: 'router-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

const catalog: Tool[] = [
  { name: 'list_unknowns', description: 'List residual unknown records', inputSchema: { type: 'object', properties: { limit: { type: 'integer', maximum: 100 } }, additionalProperties: false } },
  { name: 'inspect_binary', description: 'Inspect binary file format and metadata', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } }
];

it('exposes three tools, discovers and searches the complete catalog, and returns exact schemas', async () => {
  const upstream = { listTools: async () => ({ tools: catalog }), callTool: async () => ({ content: [] }), setNotificationHandler() {} };
  const { client, server } = await connectedRouter(upstream);
  try {
    const definitions = await client.listTools();
    expect(definitions.tools.map(tool => tool.name)).toEqual(['rea_search_tools', 'rea_get_tool_schema', 'rea_execute_tool']);
    expect(definitions.tools.length).toBeLessThan(128);
    expect(definitions.tools[2].annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const search = await client.callTool({ name: 'rea_search_tools', arguments: { query: 'binary' } });
    expect(search.structuredContent).toMatchObject({ totalTools: 2, matchCount: 1, results: [{ name: 'inspect_binary' }] });
    const schema = await client.callTool({ name: 'rea_get_tool_schema', arguments: { name: 'list_unknowns' } });
    expect(schema.structuredContent).toEqual(catalog[0]);
  } finally { await client.close(); await server.close(); }
});

it('forwards successful results and tool errors unchanged, and rejects invalid names or arguments', async () => {
  const success = { content: [{ type: 'text' as const, text: 'ok' }], structuredContent: { value: 7 }, _meta: { source: 'REA' } };
  const toolError = { content: [{ type: 'text' as const, text: 'REA rejected the operation' }], isError: true };
  const upstream = { listTools: async () => ({ tools: catalog }), callTool: async ({ name }: {name: string}) => name === 'list_unknowns' ? success : toolError, setNotificationHandler() {} };
  const { client, server } = await connectedRouter(upstream);
  try {
    expect(await client.callTool({ name: 'rea_execute_tool', arguments: { name: 'list_unknowns', arguments: { limit: 1 } } })).toEqual(success);
    expect(await client.callTool({ name: 'rea_execute_tool', arguments: { name: 'inspect_binary', arguments: {} } })).toEqual(toolError);
    await expect(client.callTool({ name: 'rea_execute_tool', arguments: { name: 'missing', arguments: {} } })).rejects.toThrow();
    await expect(client.callTool({ name: 'rea_execute_tool', arguments: { name: 'list_unknowns', arguments: [], extra: true } })).rejects.toThrow();
    await expect(client.callTool({ name: 'rea_search_tools', arguments: { query: '' } })).rejects.toThrow();
  } finally { await client.close(); await server.close(); }
});

it.skipIf(!process.env.REA_LIVE_SCRIPT)('executes harmless list_unknowns through the router and real REA engine', async () => {
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { resolve } = await import('node:path');
  const client = new Client({ name: 'rea-router-live-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/routerServer.js'), resolve(process.env.REA_LIVE_SCRIPT!)], stderr: 'pipe' });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(3);
    const lookup = await client.callTool({ name: 'rea_search_tools', arguments: { query: 'list_unknowns' } });
    const name = (lookup.structuredContent as any).results[0].name;
    const schema = await client.callTool({ name: 'rea_get_tool_schema', arguments: { name } });
    expect((schema.structuredContent as any).inputSchema.type).toBe('object');
    const result = await client.callTool({ name: 'rea_execute_tool', arguments: { name, arguments: { offset: 0, limit: 1 } } });
    expect(result.isError).not.toBe(true);
  } finally { await client.close(); }
});

it('passes the client cancellation signal to the upstream REA call', async () => {
  let receivedSignal: AbortSignal | undefined;
  const upstream = {
    listTools: async () => ({ tools: catalog }), setNotificationHandler() {},
    callTool: (_call: unknown, _meta: unknown, options: { signal?: AbortSignal }) => {
      receivedSignal = options.signal;
      return new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    }
  };
  const { client, server } = await connectedRouter(upstream);
  const controller = new AbortController();
  try {
    const pending = client.callTool({ name: 'rea_execute_tool', arguments: { name: 'list_unknowns', arguments: {} } }, undefined, { signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(receivedSignal?.aborted).toBe(true);
  } finally { await client.close(); await server.close(); }
});
