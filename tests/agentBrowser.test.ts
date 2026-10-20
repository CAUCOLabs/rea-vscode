import { expect, it, vi } from 'vitest';
import { AgentBrowserManager } from '../src/services/agentBrowser';
import { createBrowserServer } from '../src/mcp/browserServer';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

it('isolates concurrent leases and rejects attempts to close user-owned browsers', async () => {
  const closes = [vi.fn(async () => {}), vi.fn(async () => {})];
  let index = 0;
  const start = vi.fn(async () => { const i = index++; return { endpoint: `http://127.0.0.1:${42000+i}`, target: 'https://example.test/', close: closes[i] }; });
  const manager = new AgentBrowserManager(start);
  const [a,b] = await Promise.all([manager.acquire('https://example.test'), manager.acquire('https://example.test')]);
  expect(a.lease_id).not.toBe(b.lease_id);
  expect(a.cdp_endpoint).not.toBe(b.cdp_endpoint);
  await expect(manager.release('http://127.0.0.1:9222')).rejects.toThrow('Unknown');
  expect(closes.every(close => close.mock.calls.length === 0)).toBe(true);
  await manager.release(a.lease_id);
  expect(closes[0]).toHaveBeenCalledOnce(); expect(closes[1]).not.toHaveBeenCalled();
  await manager.close(); expect(closes[1]).toHaveBeenCalledOnce();
  await expect(manager.acquire('https://example.test')).rejects.toThrow('closed');
});

it('cleans up an acquisition racing with disconnect', async () => {
  const close = vi.fn(async () => {});
  let resolve!: (value: any) => void;
  const manager = new AgentBrowserManager(() => new Promise(r => { resolve = r; }));
  const pending = manager.acquire('https://example.test');
  const rejected = expect(pending).rejects.toThrow('cancelled');
  const shutdown = manager.close();
  resolve({ endpoint: 'http://127.0.0.1:45678', target: 'https://example.test', close });
  await rejected; await shutdown; expect(close).toHaveBeenCalledOnce();
});

it('exposes lifecycle over actual MCP and returns startup failures as tool errors', async () => {
  const close = vi.fn(async () => {});
  const start = vi.fn().mockRejectedValueOnce(new Error('Startup failed')).mockResolvedValue({ endpoint: 'http://127.0.0.1:45678', target: 'https://example.test/', close });
  const { server, manager } = createBrowserServer(new AgentBrowserManager(start));
  const client = new Client({ name: 'test-agent', version: '1' });
  const [a,b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(a), client.connect(b)]);
    expect((await client.listTools()).tools.map(t => t.name)).toEqual(['acquire_browser','release_browser']);
    expect((await client.callTool({ name: 'acquire_browser', arguments: { url: 'https://example.test' } })).isError).toBe(true);
    const result = await client.callTool({ name: 'acquire_browser', arguments: { url: 'https://example.test' } });
    expect(result.structuredContent).toMatchObject({ cdp_endpoint: 'http://127.0.0.1:45678', allowed_origins: ['https://example.test'] });
    expect((await client.callTool({ name: 'release_browser', arguments: { lease_id: result.structuredContent!.lease_id } })).isError).not.toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect((await client.callTool({ name: 'acquire_browser', arguments: { url: 'https://example.test', profile: '/user' } })).isError).toBe(true);
  } finally { await manager.close(); await client.close(); await server.close(); }
});
