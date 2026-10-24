import { createHash } from 'node:crypto';
import { reconstructionAgentPrompt } from '../src/analysis/agentHandoff';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { analyzeWebTarget } from '../src/analysis/webTargetAnalyzer';
import { createReconstructionProject, reconstructionFiles } from '../src/analysis/reconstructionProject';
import { WEB_TOOLS } from '../src/services/webToolPolicy';
import { webResponse, webTarget } from './webAnalyzerFixture';

it('creates runnable original files with evidence and refuses existing directories and symlinks', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'rea-project-'));
  try {
    const report = await analyzeWebTarget({ target: webTarget, endpoint: 'http://127.0.0.1:9222', tools: [...WEB_TOOLS], client: { inspectWebTarget: async tool => webResponse(tool) }, signal: new AbortController().signal, allowed: () => true, progress() {} });
    const destination = await createReconstructionProject(parent, report);
    const html = await readFile(join(destination, 'index.html'), 'utf8');
    expect(html).toContain('<button disabled>Save</button>');
    expect(html).not.toContain('<script>');
    expect(JSON.parse(await readFile(join(destination, 'evidence.json'), 'utf8')).navigation).toHaveLength(1);
    expect(await readFile(join(destination, 'styles.css'), 'utf8')).toContain('system-ui');
    expect((await readFile(join(destination, 'evidence/viewport.png'))).subarray(0, 4).toString('hex')).toBe('89504e47');
    await expect(createReconstructionProject(parent, report)).rejects.toThrow();
    expect(await readFile(join(destination, 'index.html'), 'utf8')).toBe(html);
    await symlink(destination, join(parent, 'rea-reconstruction-link'));
    await expect(createReconstructionProject(parent, report, 'rea-reconstruction-link')).rejects.toThrow();
    await expect(createReconstructionProject(parent, report, '../escape')).rejects.toThrow();
    await expect(createReconstructionProject(parent, { ...report, status: 'partial' })).rejects.toThrow('evidence');
  } finally { await rm(parent, { recursive: true, force: true }); }
});

it('exports portable scenario evidence and the same persistent agent prompt used by the handoff', async () => {
  const report = await analyzeWebTarget({ target: webTarget, endpoint: 'http://127.0.0.1:9222', tools: [...WEB_TOOLS], client: { inspectWebTarget: async tool => webResponse(tool) }, signal: new AbortController().signal, allowed: () => true, progress() {} });
  const scenario = { target: report.target, evidenceId: 'ev_' + 'a'.repeat(64), screenshot: report.screenshot!.dataBase64, screenshotHash: report.screenshot!.sha256, dom: '<main>Bounded capture</main>', domHash: 'original-provider-digest-before-truncation', accessibility: 'heading Example', completeness: 'complete' };
  const files = reconstructionFiles(report, scenario);
  expect(files['agent-handoff.md']).toBe(reconstructionAgentPrompt + '\n');
  const exported = JSON.parse(String(files['scenario-evidence.json']));
  expect(exported).toMatchObject({ evidenceId: scenario.evidenceId, actionsVerified: false, scope: 'initial observation only', untrustedContent: true, screenshot: { path: 'evidence/scenario.png', sha256: scenario.screenshotHash } });
  expect(exported.dom.sha256).toBe(createHash('sha256').update(scenario.dom).digest('hex'));
  expect(exported.dom.sourceSha256).toBe(scenario.domHash);
  expect(files['evidence/scenario.png']).toEqual(Buffer.from(scenario.screenshot, 'base64'));
  expect(() => reconstructionFiles(report, { ...scenario, target: 'https://other.test/' })).toThrow('target');
  expect(() => reconstructionFiles(report, { ...scenario, screenshotHash: 'invalid' })).toThrow('verification');
  expect(reconstructionFiles(report)['scenario-evidence.json']).toBeUndefined();
});
