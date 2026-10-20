import { describe, expect, it, vi } from 'vitest';
import { analyzeWebTarget } from '../src/analysis/webTargetAnalyzer';
import { presentAnalysis } from '../src/analysis/analysisPresentation';
import { WEB_TOOLS } from '../src/services/webToolPolicy';
import { webResponse, webTarget } from './webAnalyzerFixture';

describe('Human-readable analysis summary', () => {
  it('shows observed components, untested controls and candidate technologies without exposing provenance', async () => {
    const report = await analyzeWebTarget({ target: webTarget, endpoint: 'http://127.0.0.1:9222', tools: WEB_TOOLS, client: { inspectWebTarget: vi.fn(async name => webResponse(name)) }, signal: new AbortController().signal, allowed: () => true, progress: () => {} });
    const view = presentAnalysis(report);
    expect(view.components).toContain('Main content (1)');
    expect(view.components).toContain('Button: Save');
    expect(view.interactions.some(item => item.includes('behavior not tested'))).toBe(true);
    expect(view.resources.some(item => item.includes('Possible technology: Example library'))).toBe(true);
    expect(view.canPrepare).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/ev_[a-f0-9]{64}|normalized_result|MCP|CDP/);
    expect(view.readiness).toContain('initial UI brief');
  });
  it('does not claim success or reconstruction readiness when capture is missing', async () => {
    const report = await analyzeWebTarget({ target: webTarget, endpoint: 'http://127.0.0.1:9222', tools: [], client: { inspectWebTarget: vi.fn() }, signal: new AbortController().signal, allowed: () => true, progress: () => {} });
    const view = presentAnalysis(report);
    expect(view.status).toBe('Analysis incomplete');
    expect(view.canPrepare).toBe(false);
    expect(view.components).toHaveLength(0);
    expect(view.missing[0]).toContain('not inspected');
  });
});

it('describes retained page evidence accurately after a bundle timeout', async () => {
  const report = await analyzeWebTarget({ target: webTarget, endpoint: 'http://127.0.0.1:9222', tools: WEB_TOOLS,
    client: { inspectWebTarget: async name => { if (name === 'analyze_web_bundle') throw new Error('timeout'); return webResponse(name); } },
    signal: new AbortController().signal, allowed: () => true, progress: () => {} });
  const view = presentAnalysis(report);
  expect(view.status).toBe('Analysis incomplete');
  expect(view.components).toContain('Button: Save');
  expect(view.missing.join(' ')).toContain('Partial analysis retained');
  expect(view.missing.join(' ')).not.toContain('not inspected');
});
