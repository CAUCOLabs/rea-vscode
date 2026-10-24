import { expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ReaMcpClient } from '../src/mcp/client';
import { findBrowserExecutable, startAnalysisBrowser, type BrowserLease } from '../src/services/analysisBrowser';
import { analyzeWebTarget, decodeWebEvidence } from '../src/analysis/webTargetAnalyzer';
import { presentAnalysis } from '../src/analysis/analysisPresentation';
import { createReconstructionProject } from '../src/analysis/reconstructionProject';

// Opt-in: launches only owned browsers against a loopback fixture, invokes the
// unchanged original engine, and retains raw evidence and generated files.
it.skipIf(!process.env.REA_WEB_WORKFLOW_SCRIPT)('validates real web analysis, initial scenario and exported reconstruction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rea-web-workflow-'));
  console.log(`REA Web workflow artifacts: ${root}`);
  const client = new ReaMcpClient();
  const servers: Server[] = [];
  const browsers: BrowserLease[] = [];
  const executed: { name: string; evidenceId?: string; file: string }[] = [];
  const signal = new AbortController().signal;
  const save = async (name: string, response: unknown) => {
    const file = `${executed.length + 1}-${name}.json`;
    await writeFile(join(root, file), JSON.stringify(response, null, 2));
    executed.push({ name, file });
  };
  const serve = async (directory: string) => {
    const server = createServer(async (request, response) => {
      const pathname = new URL(request.url!, 'http://127.0.0.1').pathname;
      const files: Record<string, [string, string]> = {
        '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
        '/styles.css': ['styles.css', 'text/css'], '/evidence/viewport.png': ['evidence/viewport.png', 'image/png']
      };
      const entry = files[pathname];
      if (!entry) { response.writeHead(404); response.end(); return; }
      try { response.setHeader('Content-Type', entry[1]); response.end(await readFile(join(directory, entry[0]))); }
      catch { response.writeHead(404); response.end(); }
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  };
  try {
    const executable = await findBrowserExecutable();
    expect(executable).toBeTruthy();
    await client.connect(process.execPath, [resolve(process.env.REA_WEB_WORKFLOW_SCRIPT!), '--mcp']);
    expect(client.getTools()).toHaveLength(207);
    await writeFile(join(root, 'catalog.json'), JSON.stringify(client.getTools(), null, 2));
    const target = await serve(resolve('tests/fixtures/web-target'));
    const browser = await startAnalysisBrowser({ url: target, signal, allowed: () => client.isConnected() });
    browsers.push(browser);
    const report = await analyzeWebTarget({ target: browser.target, endpoint: browser.endpoint,
      tools: client.getTools().map(tool => tool.name), signal, allowed: () => client.isConnected(),
      progress: (percent, message) => console.log(`${percent}% ${message}`),
      client: { inspectWebTarget: async (name, endpoint, origin, id, signal) => {
        const result = await client.inspectWebTarget(name, endpoint, origin, id, signal);
        await save(name, result);
        const evidence = decodeWebEvidence(result, name);
        executed.at(-1)!.evidenceId = evidence.id;
        expect(result.isError).not.toBe(true);
        return result;
      } }
    });
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2));
    await writeFile(join(root, 'report.md'), report.markdown);
    expect(report.status, JSON.stringify(report.findings.filter(f => f.classification === 'UNKNOWN'))).toBe('captured');
    expect(report.evidence).toHaveLength(4);
    expect(report.specification).toMatch(/OBSERVED \(F\d+\): Visible viewport screenshot captured/);
    const bundleResult = JSON.parse(await readFile(join(root, executed.find(e => e.name === 'analyze_web_bundle')!.file), 'utf8'));
    const bundle = decodeWebEvidence(bundleResult, 'analyze_web_bundle').data as any;
    expect(bundle.capture.scripts_analyzed).toBe(1);
    const script = await readFile(resolve('tests/fixtures/web-target/app.js'));
    expect(bundle.capture.source_artifacts[0].sha256).toBe(createHash('sha256').update(script).digest('hex'));
    expect(bundle.capture.source_artifacts[0].bytes).toBe(script.length);
    expect(presentAnalysis(report).canPrepare).toBe(true);
    expect(report.findings.some(f => f.classification === 'OBSERVED' && f.detail.includes('Example catalog'))).toBe(true);
    expect(report.findings.some(f => f.classification === 'OBSERVED' && f.detail.includes('Search items'))).toBe(true);
    expect(report.findings.some(f => f.classification === 'OBSERVED' && f.area === 'Navigation declarations')).toBe(true);
    const png = Buffer.from(report.screenshot!.dataBase64, 'base64');
    expect(createHash('sha256').update(png).digest('hex')).toBe(report.screenshot!.sha256);
    expect(png.readUInt32BE(16)).toBe(report.screenshot!.width);
    expect(png.readUInt32BE(20)).toBe(report.screenshot!.height);
    await browser.close();
    await expect(fetch(`${browser.endpoint}/json/version`, { signal: AbortSignal.timeout(1500) })).rejects.toThrow();
    expect(client.isConnected()).toBe(true);

    const scenario = await client.captureInitialWebScenario(target, executable!, signal);
    await save('capture_browser_scenario', scenario);
    expect(scenario.isError).not.toBe(true);
    const normalized = (scenario.structuredContent as any)?.normalized_result;
    const initial = normalized?.steps?.find((step: any) => step.step_id === 'initial_observation');
    expect(initial, 'Scenario must be consumable by the existing sidebar').toBeDefined();
    expect(initial.status).toBe('completed');
    for (const name of ['screenshot', 'dom', 'accessibility', 'url']) {
      expect(initial.artifacts[name].state, `${name} scenario artifact`).toBe('captured');
    }
    const scenarioPng = Buffer.from(initial.artifacts.screenshot.value.data_base64, 'base64');
    expect(createHash('sha256').update(scenarioPng).digest('hex')).toBe(initial.artifacts.screenshot.value.sha256);
    expect(initial.artifacts.dom.value.text).toContain('Example catalog');
    expect(initial.artifacts.accessibility.value.text).toContain('Search items');

    const parent = join(root, 'projects'); await mkdir(parent);
    const project = await createReconstructionProject(parent, report, 'rea-reconstruction-verified');
    const html = await readFile(join(project, 'index.html'), 'utf8');
    expect(html).toContain('<h2>Example catalog</h2>');
    expect(html).toContain('<button disabled>Save (not implemented)</button>');
    expect(html).toContain('destination unverified');
    expect(html).not.toContain('<script');
    expect(await readFile(join(project, 'evidence/viewport.png'))).toEqual(png);
    expect(JSON.parse(await readFile(join(project, 'evidence.json'), 'utf8')).visualEvidence[0].artifact.sha256).toBe(report.screenshot!.sha256);
    expect(await readFile(join(project, 'reconstruction-brief.md'), 'utf8')).toBe(report.specification);
    const preview = await serve(project);
    expect((await fetch(preview)).status).toBe(200);
    expect((await fetch(`${preview}styles.css`)).headers.get('Content-Type')).toBe('text/css');
    expect(Buffer.from(await (await fetch(`${preview}evidence/viewport.png`)).arrayBuffer())).toEqual(png);
    const generatedBrowser = await startAnalysisBrowser({ url: preview, signal, allowed: () => client.isConnected() });
    browsers.push(generatedBrowser);
    const origin = new URL(preview).origin;
    const discovery = await client.inspectWebTarget('list_browser_targets', generatedBrowser.endpoint, origin, undefined, signal);
    await save('list_browser_targets', discovery);
    const id = (decodeWebEvidence(discovery, 'list_browser_targets').data.targets as any[])[0].target_id;
    const inspected = await client.inspectWebTarget('inspect_web_page', generatedBrowser.endpoint, origin, id, signal);
    await save('inspect_web_page', inspected);
    const page = decodeWebEvidence(inspected, 'inspect_web_page').data as any;
    expect(page.accessibility.nodes.some((node: any) => node.role === 'heading' && node.name === 'Example catalog')).toBe(true);
    const generatedScreenshot = await client.inspectWebTarget('capture_web_screenshot', generatedBrowser.endpoint, origin, id, signal);
    await save('capture_web_screenshot', generatedScreenshot);
    const artifact = (decodeWebEvidence(generatedScreenshot, 'capture_web_screenshot').data.artifact as any);
    await writeFile(join(root, 'generated-preview.png'), Buffer.from(artifact.data_base64, 'base64'));
    // Separate validation of the generated starter, not a new extension action.
    const interaction = await client.invokeTool('capture_browser_scenario', {
      browser: { mode: 'launch', executable_path: executable!, headless: true },
      start_url: { url: preview },
      actions: [{ step_id: 'section_link', action: 'click', locator: { kind: 'role', role: 'link', name: 'Limitations' }, timeout_ms: 5000 }],
      capture: { after_each_step: [], at_end: ['url', 'dom', 'accessibility'], events: [] }
    }, { timeout: 60000 }, async () => true);
    await save('capture_browser_scenario', interaction);
    expect(interaction.isError, JSON.stringify(interaction)).not.toBe(true);
    const clicked = (interaction.structuredContent as any).normalized_result.steps.find((step: any) => step.step_id === 'section_link');
    expect(clicked.status).toBe('completed');
    expect(clicked.artifacts.url.value.url).toBe(`${preview}#limitations`);
    expect(clicked.artifacts.dom.value.text).toContain('Unknown functionality');
    await generatedBrowser.close();
    await expect(fetch(`${generatedBrowser.endpoint}/json/version`, { signal: AbortSignal.timeout(1500) })).rejects.toThrow();
    await writeFile(join(root, 'validation.json'), JSON.stringify({ project, executed, catalogTools: client.getTools().length, findings: report.findings.length, screenshot: { sha256: report.screenshot!.sha256, bytes: png.length, width: report.screenshot!.width, height: report.screenshot!.height }, scenario: normalized.completeness, generatedPreview: 'passed', generatedSectionLinkClick: 'passed', browserCleanup: 'passed' }, null, 2));
  } finally {
    await writeFile(join(root, 'executed.json'), JSON.stringify(executed, null, 2));
    for (const browser of browsers.reverse()) await browser.close();
    await client.disconnect();
    for (const server of servers) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  }
}, 180000);
