import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ReaMcpClient } from '../src/mcp/client';

it.skipIf(!process.env.REA_BROWSER_LIVE_SCRIPT)('runs companion MCP → owned Chrome → real REA evidence → release', async () => {
  const http = createServer((_, res) => res.end('<!doctype html><title>REA browser MCP fixture</title><h1>Owned browser</h1>'));
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${(http.address() as {port: number}).port}`;
  const client = new Client({ name: 'codex-browser-integration-test', version: '1' });
  const rea = new ReaMcpClient();
  let lease: any;
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(process.env.REA_BROWSER_BUNDLE || 'dist/browserServer.js')], cwd: tmpdir(), stderr: 'pipe' }));
    const result = await client.callTool({ name: 'acquire_browser', arguments: { url: origin } });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    lease = result.structuredContent!;
    await rea.connect(process.execPath, [process.env.REA_BROWSER_LIVE_SCRIPT!, '--mcp']);
    const executed: string[] = [];
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await rea.invokeTool(name, args, { timeout: 60000 }, async () => true);
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      executed.push(name); return result;
    };
    const args = { cdp_endpoint: lease.cdp_endpoint, allowed_origins: lease.allowed_origins };
    const targets = await call('list_browser_targets', args);
    const normalized = (targets.structuredContent as any).normalized_result;
    expect(normalized.targets).toHaveLength(1);
    const target_id = normalized.targets[0].target_id;
    await call('inspect_web_page', { ...args, target_id });
    const screenshot = await call('capture_web_screenshot', { ...args, target_id });
    expect((screenshot.structuredContent as any).normalized_result.artifact.bytes).toBeGreaterThan(0);
    expect((await client.callTool({ name: 'release_browser', arguments: { lease_id: lease.lease_id } })).isError).not.toBe(true);
    await expect(fetch(`${lease.cdp_endpoint}/json/version`, { signal: AbortSignal.timeout(1500) })).rejects.toThrow();
    console.log('Real REA tools executed:', executed.join(', '));
    lease = undefined;
  } finally {
    if (lease) await client.callTool({ name: 'release_browser', arguments: { lease_id: lease.lease_id } });
    await client.close(); await rea.disconnect();
    await new Promise<void>(resolve => http.close(() => resolve()));
  }
}, 90000);
