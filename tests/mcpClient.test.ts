import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { ReaMcpClient } from '../src/mcp/client';
import { TaskOrchestrator } from '../src/services/taskOrchestrator';
const clients: ReaMcpClient[] = [];
const yes = async () => true;
async function connect() {
  const client = new ReaMcpClient(); clients.push(client);
  await client.connect(process.execPath, [path.resolve('tests/fixtures/mcp-server.mjs')]); return client;
}
afterEach(async () => { await Promise.all(clients.splice(0).map(c => c.disconnect())); });
describe('complete MCP transport', () => {
  it('discovers all pages and keeps complete compound schemas and arguments', async () => {
    const c = await connect(); expect(c.getTools()).toHaveLength(4);
    expect(c.getTools()[0].inputSchema.properties?.nested).toHaveProperty('oneOf');
    const args = { nested: [1,2], arbitrary: { key: true } };
    expect((await c.invokeTool('compound', args, {}, yes)).structuredContent).toEqual({ arguments: args });
    const snapshot = c.getTools(); snapshot[0].name = 'changed'; expect(c.getTools()[0].name).toBe('compound');
  });
  it('requires authorization for every tool and stops orchestration on tool errors', async () => {
    const c = await connect();
    await expect(c.invokeTool('compound', {}, {}, async () => false)).rejects.toThrow('not authorized');
    const results = await new TaskOrchestrator(c).run([{ name: 'failure', arguments: {} }, { name: 'compound', arguments: {} }], yes);
    expect(results).toHaveLength(1); expect(results[0].result.isError).toBe(true);
  });
  it('preserves images, resource links, structured evidence and binary blobs', async () => {
    const c = await connect(); const result = await c.invokeTool('artifact', {}, {}, yes);
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ data: 'AAEC', type: 'image' }), expect.objectContaining({ type: 'resource_link' })]));
    expect((await c.readResource('fixture://binary')).contents[0]).toHaveProperty('blob', 'AAEC');
    expect((await c.listResources()).resources).toHaveLength(1);
  });
  it('handles timeout and cancellation without preventing subsequent calls', async () => {
    const c = await connect();
    await expect(c.invokeTool('slow', {}, { timeout: 30 }, yes)).rejects.toThrow();
    const controller = new AbortController();
    const pending = c.invokeTool('slow', {}, { signal: controller.signal }, yes);
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toThrow();
    expect((await c.invokeTool('compound', {}, {}, yes)).isError).not.toBe(true);
  });
  it('keeps the last catalog offline and refreshes on reconnection', async () => {
    const c = await connect(); await c.disconnect(); expect(c.getTools()).toHaveLength(4);
    await expect(c.invokeTool('compound', {}, {}, yes)).rejects.toThrow('not connected');
    await c.connect(process.execPath, [path.resolve('tests/fixtures/mcp-server.mjs')]);
    expect(c.getTools()).toHaveLength(4); expect((await c.invokeTool('compound', {}, {}, yes)).structuredContent).toBeDefined();
  });
});
