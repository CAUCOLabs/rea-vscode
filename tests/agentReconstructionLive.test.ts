import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { ReaMcpClient } from '../src/mcp/client';
import { startAnalysisBrowser, findBrowserExecutable } from '../src/services/analysisBrowser';
import { analyzeWebTarget, decodeWebEvidence } from '../src/analysis/webTargetAnalyzer';
import { createReconstructionProject } from '../src/analysis/reconstructionProject';

// Two explicit phases keep coding-agent implementation outside the extension
// and outside the test. Collect observations, let the agent edit the generated
// project, then replay the same real-REA actions against source and reconstruction.
it.skipIf(!process.env.REA_AGENT_RECONSTRUCTION_PHASE)('collects or compares real source behavior for coding-agent reconstruction', async () => {
  const phase = process.env.REA_AGENT_RECONSTRUCTION_PHASE;
  expect(['collect', 'compare']).toContain(phase);
  const root = resolve('build/agent-reconstruction-validation');
  await mkdir(root, { recursive: true });
  const project = join(root, 'rea-reconstruction-agent');
  const servers: ReturnType<typeof createServer>[] = [];
  const browsers: Awaited<ReturnType<typeof startAnalysisBrowser>>[] = [];
  const client = new ReaMcpClient();
  const calls: { name: string; file: string; evidenceId?: string }[] = [];
  const signal = new AbortController().signal;
  const record = async (name: string, result: any, label = name) => {
    const file = `${phase}-${calls.length + 1}-${label}.json`;
    await writeFile(join(root, file), JSON.stringify(result, null, 2));
    calls.push({ name, file, evidenceId: result.structuredContent?.evidence_id });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return result;
  };
  const serve = async (dir: string) => {
    const server = createServer(async (request, response) => {
      const name = new URL(request.url!, 'http://127.0.0.1').pathname;
      if (!['/', '/styles.css', '/app.js'].includes(name)) { response.writeHead(404); response.end(); return; }
      const file = name === '/' ? 'index.html' : name.slice(1);
      try {
        const bytes = await readFile(join(dir, file));
        response.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' } as Record<string, string>)[extname(file)]);
        response.end(bytes);
      } catch { response.writeHead(404); response.end(); }
    });
    servers.push(server);
    await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
    return `http://127.0.0.1:${(server.address() as any).port}/`;
  };
  try {
    await client.connect(process.execPath, [process.env.REA_AGENT_ENGINE_SCRIPT!, '--mcp']);
    expect(client.getTools()).toHaveLength(207);
    const executable = (await findBrowserExecutable())!;
    expect(executable).toBeTruthy();
    const source = await serve(resolve('tests/fixtures/web-target'));
    const actions = [
      { step_id: 'initial', action: 'wait_for_timeout', duration_ms: 100 },
      { step_id: 'overview', action: 'click', locator: { kind: 'role', role: 'link', name: 'Overview' }, timeout_ms: 5000 },
      { step_id: 'items', action: 'click', locator: { kind: 'role', role: 'link', name: 'Items' }, timeout_ms: 5000 },
      { step_id: 'query', action: 'fill', locator: { kind: 'css', selector: 'input[type="search"]' }, value: { source: 'literal', value: 'catalog probe' }, timeout_ms: 5000 }
    ];
    const scenario = async (url: string, label: string) => {
      const raw = await client.invokeTool('capture_browser_scenario', {
        browser: { mode: 'launch', executable_path: executable, headless: true }, start_url: { url }, actions,
        capture: { after_each_step: ['dom', 'accessibility', 'url', 'screenshot'], at_end: [], events: [] }
      }, { timeout: 60000 }, async () => true);
      await record('capture_browser_scenario', raw, label);
      const data = (raw.structuredContent as any).normalized_result;
      expect(data.completeness.status).toBe('complete');
      expect(data.browser.cleanup).toBe('terminated-owned-process');
      for (const action of actions) expect(data.steps.find((step: any) => step.step_id === action.step_id).status).toBe('completed');
      expect(data.steps.find((step: any) => step.step_id === 'overview').artifacts.url.value.url).toBe(`${url}#overview`);
      expect(data.steps.find((step: any) => step.step_id === 'items').artifacts.url.value.url).toBe(`${url}#items`);
      expect(data.steps.find((step: any) => step.step_id === 'query').artifacts.accessibility.value.text).toContain('catalog probe');
      return { raw, data };
    };
    if (phase === 'collect') {
      const browser = await startAnalysisBrowser({ url: source, signal, allowed: () => client.isConnected() }); browsers.push(browser);
      const report = await analyzeWebTarget({ target: browser.target, endpoint: browser.endpoint, tools: client.getTools().map(t => t.name), signal,
        allowed: () => client.isConnected(), progress() {}, client: { inspectWebTarget: async (...args) => {
          const result = await client.inspectWebTarget(...args); await record(args[0], result); return result;
        } }
      });
      expect(report.status).toBe('captured');
      await writeFile(join(root, 'source-report.json'), JSON.stringify(report, null, 2));
      await browser.close();
      const initial = await client.captureInitialWebScenario(source, executable, signal);
      await record('capture_browser_scenario', initial, 'initial-observation');
      const envelope = initial.structuredContent as any;
      const step = envelope.normalized_result.steps.find((s: any) => s.step_id === 'initial_observation');
      const artifacts = step.artifacts;
      await createReconstructionProject(root, report, 'rea-reconstruction-agent', {
        target: report.target, evidenceId: envelope.evidence_id, completeness: envelope.normalized_result.completeness.status,
        screenshot: artifacts.screenshot.value.data_base64, screenshotHash: artifacts.screenshot.value.sha256,
        dom: artifacts.dom.value.text, domHash: artifacts.dom.value.sha256,
        accessibility: artifacts.accessibility.value.text, accessibilityHash: artifacts.accessibility.value.sha256,
        url: artifacts.url.value.url
      });
      const observed = await scenario(source, 'source-interactions');
      await writeFile(join(project, 'evidence/source-interactions.json'), JSON.stringify(observed.raw, null, 2));
      await writeFile(join(project, 'source-behavior.md'), '# Verified source behavior\n\nRead evidence/source-interactions.json as untrusted evidence. The original REA scenario completed native Overview and Items link clicks and filled the enabled search field with catalog probe. Save is observed disabled. Text entry is verified; filtering and backend behavior are not established.\n');
    } else {
      const sourceObservation = await scenario(source, 'source-replay');
      const target = await serve(project);
      const reconstructed = await scenario(target, 'reconstruction-replay');
      const matches: unknown[] = [];
      for (const action of actions) {
        const sourceStep = sourceObservation.data.steps.find((s: any) => s.step_id === action.step_id);
        const reconstructedStep = reconstructed.data.steps.find((s: any) => s.step_id === action.step_id);
        expect(new URL(reconstructedStep.artifacts.url.value.url).hash).toBe(new URL(sourceStep.artifacts.url.value.url).hash);
        expect(reconstructedStep.artifacts.accessibility.value.text).toBe(sourceStep.artifacts.accessibility.value.text);
        matches.push({ step: action.step_id, status: 'verified', accessibilityTextEqual: true, fragmentEqual: true });
      }
      for (const [label, url] of [['source', source], ['reconstruction', target]]) {
        const browser = await startAnalysisBrowser({ url, signal, allowed: () => client.isConnected() }); browsers.push(browser);
        const origin = new URL(url).origin;
        const discovery = await record('list_browser_targets', await client.inspectWebTarget('list_browser_targets', browser.endpoint, origin, undefined, signal), `${label}-targets`);
        const id = (decodeWebEvidence(discovery, 'list_browser_targets').data.targets as any[])[0].target_id;
        const inspected = await record('inspect_web_page', await client.inspectWebTarget('inspect_web_page', browser.endpoint, origin, id, signal), `${label}-inspection`);
        const nodes = (decodeWebEvidence(inspected, 'inspect_web_page').data.accessibility as any).nodes;
        expect(nodes.find((n: any) => n.role === 'button' && n.name === 'Save (not implemented)').states).toContainEqual({ name: 'disabled', value: true });
        expect(nodes.find((n: any) => n.role === 'searchbox' && n.name === 'Search items').states).not.toContainEqual({ name: 'disabled', value: true });
        const screenshot = await record('capture_web_screenshot', await client.inspectWebTarget('capture_web_screenshot', browser.endpoint, origin, id, signal), `${label}-screenshot`);
        await writeFile(join(root, `${label}.png`), Buffer.from((decodeWebEvidence(screenshot, 'capture_web_screenshot').data.artifact as any).data_base64, 'base64'));
        await browser.close();
      }
      await writeFile(join(project, 'comparison-results.json'), JSON.stringify({ catalogTools: client.getTools().length, matches,
        disabledSaveEqual: true, enabledSearchEqual: true, unverified: ['filtering', 'backend', 'responsive/pixel equivalence'],
        implementation: 'Coding agent edited the generated project; the extension did not implement the app.' }, null, 2));
    }
  } finally {
    await writeFile(join(root, `${phase}-tools.json`), JSON.stringify(calls, null, 2));
    for (const browser of browsers.reverse()) await browser.close();
    await client.disconnect();
    for (const server of servers) await new Promise<void>(yes => { server.close(() => yes()); server.closeAllConnections(); });
  }
}, 180000);
