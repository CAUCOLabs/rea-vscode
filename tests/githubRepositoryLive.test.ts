import { expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ReaMcpClient } from '../src/mcp/client';
import { initializeEngineRuntime, resolveEngineLaunch } from '../src/services/engineRuntime';
import { analyzeGitHubRepository, exportRepositoryReport } from '../src/analysis/githubRepositoryAnalyzer';
import { createRepositoryHandoff } from '../src/services/repositoryHandoff';
import { requestGitHub } from '../src/services/githubRepository';

it.skipIf(!process.env.REA_GITHUB_LIVE)('analyzes a real unauthenticated public repository with the unchanged bundled REA engine', async () => {
  initializeEngineRuntime(process.cwd());
  const launch = await resolveEngineLaunch();
  const client = new ReaMcpClient();
  const output = resolve('build/github-repository-validation');
  await mkdir(output, { recursive: true });
  try {
    await client.connect(launch.command, launch.args);
    expect(client.getTools()).toHaveLength(207);
    const progress: string[] = [], requests: string[] = [];
    const apiResponses: Record<string, unknown> = {};
    const report = await analyzeGitHubRepository({
      url: 'https://github.com/expressjs/express', signal: new AbortController().signal,
      allowed: () => true, client, progress: message => progress.push(message),
      request: async (path, signal, bytes) => { requests.push(path); const result = await requestGitHub(path, signal, bytes); apiResponses[path] = result; return result; }
    });
    await writeFile(resolve(output, 'api-responses.json'), JSON.stringify(apiResponses));
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    await writeFile(resolve(output, 'repository-analysis.md'), exportRepositoryReport(report));
    expect(report.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(report.files.some(f => f.path === 'package.json')).toBe(true);
    expect(report.entries.some(e => e.path === 'lib/application.js')).toBe(true);
    expect(report.languages.some(l => l.name === 'JavaScript')).toBe(true);
    expect(report.dependencies.some(d => d.name === 'router')).toBe(true);
    expect(report.entryPoints.some(e => e.path === 'index.js')).toBe(true);
    expect(report.rea.status).toBe('captured');
    expect(report.rea.modules).toBeDefined();
    expect(JSON.stringify(report.rea.result)).toContain('evidence_id');
    const handoff = await createRepositoryHandoff(output, report);
    const evidence = JSON.parse(await readFile(resolve(handoff, 'repository-evidence.json'), 'utf8'));
    expect(evidence.commit).toBe(report.commit);
    expect(evidence.files.some((f: any) => f.path === 'lib/application.js')).toBe(true);
    expect(await readFile(resolve(handoff, 'agent-handoff.md'), 'utf8')).toContain('untrusted data');
    await expect(requestGitHub('/repos/expressjs/rea-validation-missing-repository-040-20261024', new AbortController().signal, 512000)).rejects.toThrow('not found');
    await writeFile(resolve(output, 'validation.json'), JSON.stringify({ target: report.target, commit: report.commit, entries: report.entries.length, capturedFiles: report.files.length, dependencies: report.dependencies.length, entryPoints: report.entryPoints.length, languages: report.languages, rea: report.rea.status, handoff, requestCount: requests.length, requests, progress, missingRepositoryErrorVerified: true, authenticationUsed: false, toolsDiscovered: client.getTools().length }, null, 2));
  } finally { await client.disconnect(); }
}, 240000);
