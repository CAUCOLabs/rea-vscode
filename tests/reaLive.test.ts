import { expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { startAnalysisBrowser } from '../src/services/analysisBrowser';
import { ReaMcpClient } from '../src/mcp/client';

it.skipIf(!process.env.REA_LIVE_SCRIPT)('audits installed REA without mutating its installation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rea-engine-audit-'));
  const c = new ReaMcpClient(); const results: unknown[] = [];
  const yes = async () => true; // Explicit fixture operations, never arbitrary catalog execution.
  const call = async (name: string, args: Record<string, unknown>) => {
    try {
      const result = await c.invokeTool(name, args, { timeout: 60_000 }, yes);
      results.push({ name, isError: result.isError ?? false, structured: !!result.structuredContent, result });
      return result;
    } catch (error) { results.push({ name, error: String(error) }); return undefined; }
  };
  try {
    await c.connect(process.execPath, [process.env.REA_LIVE_SCRIPT!, 'mcp']);
    const catalog = c.getTools(); expect(catalog.length).toBeGreaterThan(200);
    expect(new Set(catalog.map(t => t.name)).size).toBe(catalog.length);
    for (const tool of catalog) expect(tool.inputSchema.type).toBe('object');
    await writeFile(path.join(root, 'catalog.json'), JSON.stringify(catalog, null, 2));
    await writeFile(path.join(root, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>REA test</string></dict></plist>');
    await writeFile(path.join(root, 'package.json'), '{"name":"rea-audit-fixture","version":"1.0.0","main":"main.js"}');
    await writeFile(path.join(root, 'main.js'), 'export function add(a,b) { return a + b; }');
    await call('list_unknowns', { limit: 1 });
    await call('binary_session', {});
    await call('inspect_plist', { path: path.join(root, 'Info.plist') });
    await call('inspect_binary_layout', { path: '/usr/bin/true', detail: 'summary' });
    await call('analyze_javascript_application', { input_path: root, source_paths: ['package.json','main.js'], detail: 'summary' });
    await call('inspect_with_objdump', { path: '/usr/bin/true', operation: 'file_headers' });
    await call('inspect_adb_client', {});
    await call('inspect_pcap_client', {});
    const http = createServer((_, response) => { response.end('<!doctype html><title>REA audit</title><h1>Local fixture</h1>'); });
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    const address = http.address() as { port: number };
    let browser: Awaited<ReturnType<typeof startAnalysisBrowser>> | undefined;
    try {
      const origin = `http://127.0.0.1:${address.port}`;
      browser = await startAnalysisBrowser({ url: origin, signal: new AbortController().signal, allowed: () => true });
      const targets = await call('list_browser_targets', { cdp_endpoint: browser.endpoint, allowed_origins: [origin] });
      // Full raw result is retained; choose the target from the owned browser's CDP inventory.
      const pages = await (await fetch(`${browser.endpoint}/json/list`)).json() as { id: string; type: string }[];
      const target = pages.find(page => page.type === 'page')!;
      await call('inspect_web_page', { cdp_endpoint: browser.endpoint, allowed_origins: [origin], target_id: target.id });
      const screenshot = await call('capture_web_screenshot', { cdp_endpoint: browser.endpoint, allowed_origins: [origin], target_id: target.id });
      expect(targets).toBeDefined(); expect(targets?.isError).not.toBe(true);
      expect(screenshot).toBeDefined(); expect(screenshot?.isError).not.toBe(true);
      const evidence = screenshot!.structuredContent as any;
      const artifact = evidence.normalized_result.artifact;
      const png = Buffer.from(artifact.data_base64, 'base64');
      expect(png.length).toBe(artifact.bytes);
      expect(createHash('sha256').update(png).digest('hex')).toBe(artifact.sha256);
      await writeFile(path.join(root, 'screenshot.png'), png);
    } finally { await browser?.close(); await new Promise<void>(resolve => http.close(() => resolve())); }
    const bundle = path.join(root, 'evidence.json');
    await call('export_evidence_bundle', { path: bundle, overwrite: false });
    expect((await readFile(bundle)).length).toBeGreaterThan(0);
    await call('get_evidence_bundle', { detail: 'summary' });
    // Invalid input must return a tool error or protocol error, never a success.
    const invalid = await call('inspect_binary_layout', { path: 42 });
    expect(!invalid || invalid.isError).toBeTruthy();
    await c.disconnect(); expect(c.getTools().length).toBe(catalog.length);
    await c.connect(process.execPath, [process.env.REA_LIVE_SCRIPT!, 'mcp']);
    expect(c.getTools().map(t => t.name)).toEqual(catalog.map(t => t.name));
    console.log(`REA audit artifacts: ${root}`);
    console.log(JSON.stringify(results.map(({result, ...rest}: any) => rest)));
  } finally {
    await writeFile(path.join(root, 'results.json'), JSON.stringify(results, null, 2));
    await c.disconnect();
  }
}, 180_000);
