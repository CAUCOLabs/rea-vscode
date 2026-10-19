import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { analyzeWebTarget } from '../src/analysis/webTargetAnalyzer';
import { createReconstructionProject } from '../src/analysis/reconstructionProject';
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
