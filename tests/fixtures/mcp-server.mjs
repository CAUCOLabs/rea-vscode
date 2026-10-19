import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ReadResourceRequestSchema, ListResourcesRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'transport-fixture', version: '1' }, { capabilities: { tools: {}, resources: {} } });
const names = ['compound', 'artifact', 'failure', 'slow'];
server.setRequestHandler(ListToolsRequestSchema, async ({ params }) => ({
  tools: (params?.cursor ? names.slice(2) : names.slice(0,2)).map(name => ({ name, inputSchema: { type: 'object', properties: { nested: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }] } }, additionalProperties: true } })),
  ...(params?.cursor ? {} : { nextCursor: 'second' })
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
  if (params.name === 'slow') await new Promise(resolve => { const timer = setTimeout(resolve, 5000); extra.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
  if (params.name === 'failure') return { content: [{ type: 'text', text: 'fixture error' }], isError: true };
  if (params.name === 'artifact') return { content: [{ type: 'image', mimeType: 'image/png', data: 'AAEC' }, { type: 'resource_link', name: 'binary', uri: 'fixture://binary', mimeType: 'application/octet-stream' }], structuredContent: { uri: 'fixture://binary' } };
  return { content: [], structuredContent: { arguments: params.arguments } };
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ name: 'binary', uri: 'fixture://binary' }] }));
server.setRequestHandler(ReadResourceRequestSchema, async () => ({ contents: [{ uri: 'fixture://binary', mimeType: 'application/octet-stream', blob: 'AAEC' }] }));
await server.connect(new StdioServerTransport());
