import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ReadResourceRequestSchema, ListResourcesRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'transport-fixture', version: '1' }, { capabilities: { tools: {}, resources: {} } });
const web = process.argv[2] ? JSON.parse(await (await import('node:fs/promises')).readFile(process.argv[2], 'utf8')) : undefined;
const names = ['compound', 'artifact', 'failure', 'slow'];
server.setRequestHandler(ListToolsRequestSchema, async ({ params }) => ({
  tools: web ? Object.entries(web.schemas).map(([name, inputSchema]) => ({ name, inputSchema })) : (params?.cursor ? names.slice(2) : names.slice(0,2)).map(name => ({ name, inputSchema: { type: 'object', properties: { nested: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }] } }, additionalProperties: true } })),
  ...(web || params?.cursor ? {} : { nextCursor: 'second' })
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
  if (web) {
    if (params.name === 'analyze_web_bundle') {
      if (web.bundleExit) process.exit(1);
      process.stderr.write('diagnostic\n'.repeat(100000));
      if (web.bundleDelay) await new Promise(resolve => {
        const timer = setTimeout(resolve, web.bundleDelay);
        extra.signal.addEventListener('abort', () => {
          if (web.exitAfterCancel) setTimeout(() => {
            process.stderr.write('UnhandledPromiseRejection AbortError token=DO_NOT_LOG https://secret.test/?private=DO_NOT_LOG /Users/private/source.js\n');
            process.exit(1);
          }, web.exitAfterCancel);
          if (!web.ignoreCancel) { clearTimeout(timer); resolve(); }
        }, { once: true });
      });
    }
    if (web.close && params.name === 'inspect_web_page') { process.exit(0); }
    return web.responses[params.name];
  }
  if (params.name === 'slow') await new Promise(resolve => { const timer = setTimeout(resolve, 5000); extra.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
  if (params.name === 'failure') return { content: [{ type: 'text', text: 'fixture error' }], isError: true };
  if (params.name === 'artifact') return { content: [{ type: 'image', mimeType: 'image/png', data: 'AAEC' }, { type: 'resource_link', name: 'binary', uri: 'fixture://binary', mimeType: 'application/octet-stream' }], structuredContent: { uri: 'fixture://binary' } };
  return { content: [], structuredContent: { arguments: params.arguments } };
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ name: 'binary', uri: 'fixture://binary' }] }));
server.setRequestHandler(ReadResourceRequestSchema, async () => ({ contents: [{ uri: 'fixture://binary', mimeType: 'application/octet-stream', blob: 'AAEC' }] }));
await server.connect(new StdioServerTransport());
