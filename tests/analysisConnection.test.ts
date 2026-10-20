import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ReaMcpClient } from '../src/mcp/client';
import { ConnectionManager } from '../src/services/connectionManager';
import { analyzeWebTarget } from '../src/analysis/webTargetAnalyzer';
import { WEB_TOOLS } from '../src/services/webToolPolicy';
import { webSchemas, webResponse, webTarget } from './webAnalyzerFixture';

it.each([false, true])('keeps MCP usable after analysis with a >10 MiB response; realClose=%s', async close => {
  const dir = await mkdtemp(join(tmpdir(), 'rea-mcp-regression-'));
  const client = new ReaMcpClient();
  const manager = new ConnectionManager(client);
  const logs: string[] = [];
  client.onDiagnostic = message => logs.push(message);
  try {
    const responses = Object.fromEntries(WEB_TOOLS.map(tool => [tool, webResponse(tool)]));
    // A valid MCP envelope above the SDK default limit. Local evidence validation
    // may reject it; that operation error must never destroy the main session.
    Object.assign(responses.capture_web_screenshot, { padding: 'x'.repeat(11 * 1024 * 1024) });
    const fixture = join(dir, 'responses.json');
    await writeFile(fixture, JSON.stringify({ schemas: webSchemas, responses, close }));
    await manager.connect(process.execPath, [resolve('tests/fixtures/mcp-server.mjs'), fixture]);
    const analyze = () => analyzeWebTarget({ target: webTarget, endpoint: 'http://127.0.0.1:9222', tools: [...WEB_TOOLS], client, signal: new AbortController().signal, allowed: () => manager.isConnected(), progress: () => {} });
    if (close) {
      await expect(analyze()).rejects.toThrow();
      expect(manager.getState()).toBe('disconnected');
      expect(logs.some(line => line.includes('transport closed'))).toBe(true);
    } else {
      expect((await analyze()).status).toBe('captured');
      expect(manager.isConnected()).toBe(true);
      expect(await client.listTools()).toHaveLength(4);
      expect((await analyze()).status).toBe('captured');
      expect(manager.isConnected()).toBe(true);
    }
  } finally { await manager.disconnect(); await rm(dir, { recursive: true, force: true }); }
}, 20000);

it.each(['cooperative', 'late-response', 'server-exit', 'long-success'] as const)(
  'isolates bundle timeout and retains evidence: %s', async mode => {
    const dir = await mkdtemp(join(tmpdir(), 'rea-timeout-regression-'));
    const long = mode === 'long-success';
    const client = new ReaMcpClient(() => ({ webOperationTimeoutMs: 1000, bundleAnalysisTimeoutMs: long ? 25_000 : mode === 'server-exit' ? 20_000 : 100 }));
    const manager = new ConnectionManager(client);
    const logs: string[] = [];
    client.onDiagnostic = line => logs.push(line);
    try {
      const fixture = join(dir, 'responses.json');
      await writeFile(fixture, JSON.stringify({ schemas: webSchemas,
        responses: Object.fromEntries(WEB_TOOLS.map(tool => [tool, webResponse(tool)])),
        bundleDelay: long ? 20_100 : mode === 'server-exit' ? 30_000 : 350,
        ignoreCancel: mode === 'late-response', exitAfterCancel: mode === 'server-exit' ? 4_000 : 0 }));
      await manager.connect(process.execPath, [resolve('tests/fixtures/mcp-server.mjs'), fixture]);
      const report = await analyzeWebTarget({ target: webTarget, endpoint: 'http://127.0.0.1:9222',
        tools: [...WEB_TOOLS], client, signal: new AbortController().signal,
        allowed: () => manager.isConnected(), progress: () => {} });
      expect(report.evidence.map(e => e.tool)).toEqual(long ? ['list_browser_targets', 'inspect_web_page', 'capture_web_screenshot', 'analyze_web_bundle'] : ['list_browser_targets', 'inspect_web_page', 'capture_web_screenshot']);
      expect(report.screenshot).toBeDefined();
      expect(report.status).toBe(long ? 'captured' : 'partial');
      expect(manager.isConnected()).toBe(true);
      if (!long) {
        expect(logs.some(line => line.includes('outcome=timeout'))).toBe(true);
        expect(logs.some(line => line.includes('transport close invoked'))).toBe(false);
        await new Promise(resolve => setTimeout(resolve, mode === 'server-exit' ? 4_500 : 450));
      }
      if (mode === 'server-exit') {
        expect(manager.getState()).toBe('disconnected');
        expect(logs.some(line => line.includes('intentional=false') && line.includes('abort-error') && line.includes('unhandled-rejection') && line.includes('lastOutcome=timeout'))).toBe(true);
        await expect(client.listTools()).rejects.toThrow('not connected');
      } else {
        expect(manager.isConnected()).toBe(true);
        expect(await client.listTools()).toHaveLength(4);
      }
      expect(logs.join('\n')).not.toMatch(/DO_NOT_LOG|secret\.test|\/Users\/private/);
    } finally { await manager.disconnect(); await rm(dir, { recursive: true, force: true }); }
  }, 30_000
);

it('retains page and screenshot when the server dies during bundle analysis', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rea-exit-regression-'));
  const client = new ReaMcpClient();
  const manager = new ConnectionManager(client);
  try {
    const fixture = join(dir, 'responses.json');
    await writeFile(fixture, JSON.stringify({ schemas: webSchemas,
      responses: Object.fromEntries(WEB_TOOLS.map(tool => [tool, webResponse(tool)])), bundleExit: true }));
    await manager.connect(process.execPath, [resolve('tests/fixtures/mcp-server.mjs'), fixture]);
    const report = await analyzeWebTarget({ target: webTarget, endpoint: 'http://127.0.0.1:9222', tools: [...WEB_TOOLS], client,
      signal: new AbortController().signal, allowed: () => manager.isConnected(), progress: () => {} });
    expect(manager.getState()).toBe('disconnected');
    expect(report.status).toBe('partial');
    expect(report.screenshot).toBeDefined();
    expect(report.evidence).toHaveLength(3);
    expect(report.findings.some(f => f.area === 'Connection')).toBe(true);
  } finally { await manager.disconnect(); await rm(dir, { recursive: true, force: true }); }
});
