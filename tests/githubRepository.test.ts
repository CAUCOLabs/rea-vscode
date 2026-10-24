import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { githubRepositoryUrl, portableRepositoryPath, retrieveGitHubRepository, type GitHubRequest } from '../src/services/githubRepository';
import { analyzeGitHubRepository, exportRepositoryReport, repositoryModuleFindings, summarizeRepository } from '../src/analysis/githubRepositoryAnalyzer';
import { createRepositoryHandoff } from '../src/services/repositoryHandoff';
import { parseSidebarMessage } from '../src/views/sidebarProtocol';

const commit = 'a'.repeat(40), tree = 'b'.repeat(40);
export function repositoryFixture(files: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'fixture', main: 'index.js', dependencies: { express: '^5' }, devDependencies: { typescript: '^5' }, scripts: { start: 'touch SHOULD_NOT_EXIST' } }),
  'index.js': 'export { app } from "./src/app.js";',
  'src/app.js': 'export const app = "fixture";',
  'pyproject.toml': '[project]\ndependencies = ["fastapi>=0.1"]\n[project.scripts]\napi = "app:main"\n',
  'Cargo.toml': '[dependencies]\naxum = "0.8"',
  'requirements.txt': 'flask==3.0\n# comment\n-r private.txt',
  'go.mod': 'module example.test/app\nrequire example.test/library v1.2.3',
  'composer.json': '{"require":{"laravel/framework":"^12"}}'
}) {
  const blobs = Object.entries(files).map(([path, text]) => {
    const bytes = Buffer.from(text), sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    return { path, text, sha, size: bytes.length, type: 'blob', mode: '100644' };
  });
  const request = vi.fn<GitHubRequest>(async (path) => {
    if (path === '/repos/example/app') return { private: false, default_branch: 'main' };
    if (path.endsWith('/commits/main')) return { sha: commit, commit: { tree: { sha: tree } } };
    if (path.endsWith('?recursive=1')) return { sha: tree, truncated: false, tree: [...blobs, { path: 'src', mode: '040000', type: 'tree', sha: tree }] };
    const blob = blobs.find(b => path.endsWith('/git/blobs/' + b.sha));
    if (blob) return { sha: blob.sha, encoding: 'base64', content: Buffer.from(blob.text).toString('base64') };
    throw new Error('Unexpected request: ' + path);
  });
  return { request, blobs };
}
const tool = { name: 'analyze_javascript_application', inputSchema: { type: 'object' as const, properties: { input_path: { type: 'string' }, source_paths: { type: 'array' }, detail: { type: 'string' } } } };
const signal = () => new AbortController().signal;

describe('Public repository retrieval boundaries', () => {
  it('accepts canonical public URLs and .git suffixes', () => {
    expect(githubRepositoryUrl('https://github.com/example/app.git/').url).toBe('https://github.com/example/app');
  });
  it.each(['http://github.com/example/app', 'https://github.com.evil.test/example/app', 'https://user:pass@github.com/example/app', 'https://github.com/example/app/tree/main', 'https://github.com/example/app?q=x', 'https://github.com/example/..', 'https://github.com/example/%2e%2e', 'git@github.com:example/app.git', 'file:///tmp/repo', 'https://github.com:443/example/app', 'https://github.com/example/app#main'])('rejects unsafe or unsupported URL %s before requesting', async url => {
    const request = vi.fn();
    await expect(retrieveGitHubRepository(url, signal(), request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it.each(['../escape', '/absolute', 'src/../../escape', 'src\\escape', 'C:/escape', 'src/CON.js', '.git/config', 'src/file.', 'a\u0000b'])('rejects unsafe portable paths: %s', path => {
    expect(portableRepositoryPath(path)).toBe(false);
  });
  it('pins metadata, tree and blob reads; verifies bytes and preserves inventory', async () => {
    const { request } = repositoryFixture();
    const snapshot = await retrieveGitHubRepository('https://github.com/example/app', signal(), request);
    expect(snapshot.commit).toBe(commit);
    expect(snapshot.entries.some(e => e.path === 'src')).toBe(true);
    expect(snapshot.files.some(f => f.path === 'src/app.js')).toBe(true);
    expect(snapshot.files.every(f => f.sha256 === createHash('sha256').update(f.text).digest('hex'))).toBe(true);
    expect(request.mock.calls[2][0]).toBe(`/repos/example/app/git/trees/${tree}?recursive=1`);
  });
  it('excludes symlinks, submodules and case collisions; flags incomplete trees', async () => {
    const { request } = repositoryFixture({ 'package.json': '{}' });
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (...args) => {
      const value: any = await original(...args);
      if (args[0].includes('?recursive')) return { ...value, truncated: true, tree: [...value.tree,
        { path: 'unsafe.js', mode: '120000', type: 'blob', sha: commit, size: 3 },
        { path: 'submodule', mode: '160000', type: 'commit', sha: commit },
        { path: '../outside.js', mode: '100644', type: 'blob', sha: commit, size: 3 },
        { path: 'PACKAGE.JSON', mode: '100644', type: 'blob', sha: commit, size: 3 }] };
      return value;
    });
    const snapshot = await retrieveGitHubRepository('https://github.com/example/app', signal(), request);
    expect(snapshot.files.map(f => f.path)).toEqual(['package.json']);
    expect(snapshot.limitations.join(' ')).toMatch(/partial.*unsafe/s);
  });
  it('rejects corrupted blob content and mismatched tree identities', async () => {
    const { request } = repositoryFixture({ 'index.js': 'x' });
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (...args) => args[0].includes('/blobs/') ? { sha: createHash('sha1').update('blob 1\0x').digest('hex'), encoding: 'base64', content: 'eQ==' } : original(...args));
    await expect(retrieveGitHubRepository('https://github.com/example/app', signal(), request)).rejects.toThrow('integrity');
    request.mockImplementation(async (...args) => args[0].includes('?recursive') ? { sha: commit, tree: [] } : original(...args));
    await expect(retrieveGitHubRepository('https://github.com/example/app', signal(), request)).rejects.toThrow('identity');
  });
  it('prioritizes production source over numerous example entry points', async () => {
    const files = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`examples/demo${i}/index.js`, `export const demo = ${i}`]));
    files['lib/application.js'] = 'export const app = 1'; files['package.json'] = '{}'; files['index.js'] = 'export {}';
    const snapshot = await retrieveGitHubRepository('https://github.com/example/app', signal(), repositoryFixture(files).request);
    expect(snapshot.files.slice(0, 3).map(f => f.path)).toEqual(['package.json', 'index.js', 'lib/application.js']);
  });
  it('bounds retrieval to 24 blobs and skips oversized files', async () => {
    const files = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`src/file${i}.js`, `export const n = ${i}`]));
    files['huge.js'] = 'x'.repeat(256 * 1024 + 1);
    const { request } = repositoryFixture(files);
    const snapshot = await retrieveGitHubRepository('https://github.com/example/app', signal(), request);
    expect(snapshot.files).toHaveLength(24);
    expect(request.mock.calls.filter(([p]) => p.includes('/blobs/'))).toHaveLength(24);
    expect(snapshot.files.some(f => f.path === 'huge.js')).toBe(false);
  });
  it('reports private, empty and failed retrieval without starting REA', async () => {
    const client = { getTools: () => [tool], invokeTool: vi.fn() };
    for (const request of [async () => ({ private: true }), async () => ({ private: false }), async () => { throw new Error('rate limit'); }]) {
      await expect(analyzeGitHubRepository({ url: 'https://github.com/example/app', signal: signal(), allowed: () => true, request, client })).rejects.toThrow();
    }
    expect(client.invokeTool).not.toHaveBeenCalled();
  });
});

describe('Repository analysis and agent evidence', () => {
  it('detects manifests, declared dependencies, framework candidates and entry points', async () => {
    const snapshot = await retrieveGitHubRepository('https://github.com/example/app', signal(), repositoryFixture().request);
    const report = summarizeRepository(snapshot);
    expect(report.dependencies.map(d => d.name)).toEqual(expect.arrayContaining(['express', 'typescript', 'fastapi', 'flask', 'axum', 'example.test/library', 'laravel/framework']));
    expect(report.frameworks).toContain('express');
    expect(report.entryPoints).toContainEqual({ path: 'package.json', declaration: 'main: "index.js"' });
    expect(report.languages).toContainEqual({ name: 'JavaScript', files: 2 });
    expect(report.architecture.some(f => f.classification === 'INFERRED')).toBe(true);
  });
  it('uses only the original static tool and cleans its temporary snapshot', async () => {
    let root = '';
    const client = { getTools: () => [tool], invokeTool: vi.fn(async (name, args, options, authorize) => {
      expect(name).toBe('analyze_javascript_application'); expect(args.detail).toBe('summary'); expect(options.signal).toBeDefined();
      expect(await authorize(tool)).toBe(true);
      root = args.input_path;
      expect(await readFile(join(root, 'index.js'), 'utf8')).toContain('export');
      expect(args.source_paths).not.toContain('pyproject.toml');
      return { content: [], structuredContent: { evidence_id: 'ev_test', input: root, modules: 2 } };
    }) };
    const report = await analyzeGitHubRepository({ url: 'https://github.com/example/app', signal: signal(), allowed: () => true, request: repositoryFixture().request, client });
    expect(report.rea.status).toBe('captured');
    expect((report.rea.result as any).structuredContent.input).toBe(root);
    await expect(access(root)).rejects.toThrow();
    expect(client.invokeTool).toHaveBeenCalledOnce();
  });
  it('retains usable evidence on REA tool failure and marks the failure', async () => {
    const report = await analyzeGitHubRepository({ url: 'https://github.com/example/app', signal: signal(), allowed: () => true, request: repositoryFixture().request, client: { getTools: () => [tool], invokeTool: async () => ({ content: [], isError: true }) } });
    expect(report.rea.status).toBe('failed'); expect(report.entries.length).toBeGreaterThan(0);
    expect(exportRepositoryReport(report)).toContain('Status: failed');
  });
  it('supports non-JavaScript evidence without inventing REA coverage', async () => {
    const invokeTool = vi.fn();
    const report = await analyzeGitHubRepository({ url: 'https://github.com/example/app', signal: signal(), allowed: () => true, request: repositoryFixture({ 'main.py': 'print("never executed")', 'requirements.txt': 'flask==3' }).request, client: { getTools: () => [tool], invokeTool } });
    expect(report.rea.status).toBe('unavailable'); expect(report.frameworks).toEqual(['flask']); expect(invokeTool).not.toHaveBeenCalled();
  });
  it('does not invoke tools when untrusted or cancelled, or after authorization changes', async () => {
    const invokeTool = vi.fn(), controller = new AbortController(); controller.abort();
    const options = { url: 'https://github.com/example/app', signal: controller.signal, allowed: () => true, request: repositoryFixture().request, client: { getTools: () => [tool], invokeTool } };
    await expect(analyzeGitHubRepository(options)).rejects.toThrow();
    await expect(analyzeGitHubRepository({ ...options, signal: signal(), allowed: () => false })).rejects.toThrow('trusted');
    let allowed = true;
    const request = repositoryFixture().request, original = request.getMockImplementation()!;
    request.mockImplementation(async (...args) => { const result = await original(...args); if (args[0].includes('/blobs/')) allowed = false; return result; });
    await expect(analyzeGitHubRepository({ ...options, signal: signal(), request, allowed: () => allowed })).rejects.toThrow('authorized');
    expect(invokeTool).not.toHaveBeenCalled();
  });
  it('exports a fresh evidence-only handoff with pinned identities and untrusted content', async () => {
    const report = await analyzeGitHubRepository({ url: 'https://github.com/example/app', signal: signal(), allowed: () => true, request: repositoryFixture().request, client: { getTools: () => [], invokeTool: vi.fn() } });
    const parent = await mkdtemp(join(tmpdir(), 'rea-handoff-test-'));
    try {
      const destination = await createRepositoryHandoff(parent, report);
      expect((await readdir(destination)).sort()).toEqual(['agent-handoff.md', 'repository-analysis.md', 'repository-evidence.json']);
      const evidence = JSON.parse(await readFile(join(destination, 'repository-evidence.json'), 'utf8'));
      expect(evidence.commit).toBe(commit); expect(evidence.untrustedContent).toBe(true);
      expect(evidence.files[0].text).toContain('SHOULD_NOT_EXIST');
      expect(await readFile(join(destination, 'agent-handoff.md'), 'utf8')).toContain('Codex or Copilot');
      expect(await readFile(join(destination, 'repository-analysis.md'), 'utf8')).toContain('Architecture and module boundaries');
      const second = await createRepositoryHandoff(parent, report); expect(second).not.toBe(destination);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
  it('validates sidebar messages without allowing injected paths or tool names', () => {
    expect(parseSidebarMessage({ type: 'analyzeGitHubRepository', url: 'https://github.com/example/app' })).toBeDefined();
    expect(parseSidebarMessage({ type: 'analyzeGitHubRepository', url: 'x', destination: '/tmp/arbitrary' })).toBeUndefined();
    expect(parseSidebarMessage({ type: 'handoffRepository', path: '/tmp/arbitrary' })).toBeUndefined();
    expect(parseSidebarMessage({ type: 'exportRepositoryReport' })).toEqual({ type: 'exportRepositoryReport' });
  });
});


it('projects provider module facts and coverage without inventing relationships', () => {
  const wrap = (value: unknown) => ({ structuredContent: { normalized_result: value } });
  const findings = repositoryModuleFindings(wrap({ summary: { statistics: { parsed_javascript_files: 2, parse_failures: 0 } } }), wrap({ items: [{ path: 'lib/app.js', kind: 'javascript-module' }, { path: 'lib/app.js', kind: 'javascript-module' }] }));
  expect(findings).toHaveLength(2);
  expect(findings[0].detail).toContain('2 selected JavaScript files');
  expect(findings[1].paths).toEqual(['lib/app.js']);
  expect(findings[1].detail).toContain('First page only');
  expect(repositoryModuleFindings({}, {})).toEqual([]);
});


it('keeps untrusted manifest text inert in exported Markdown', async () => {
  const snapshot = await retrieveGitHubRepository('https://github.com/example/app', signal(), repositoryFixture({ 'package.json': JSON.stringify({ dependencies: { '\n# ![image](https://example.test/track)': '*' } }) }).request);
  const report = { ...summarizeRepository(snapshot), rea: { status: 'unavailable' as const, sourcePaths: [] } };
  const markdown = exportRepositoryReport(report);
  expect(markdown).not.toContain('![image](');
  expect(markdown).not.toContain('\n# !');
  expect(markdown).toContain('&#33;');
});
