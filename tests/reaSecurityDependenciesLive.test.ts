import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { prepareReaSecurityDependencies, verifyReaSecurityDependencies } from '../scripts/rea-security-dependencies.mjs';
import { validatePreparedRuntime } from '../scripts/validate-runtime.mjs';
import { saveRuntimeCandidate } from '../scripts/save-runtime-candidate.mjs';

const execute = promisify(execFile);
const project = process.cwd();
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

it.skipIf(!process.env.REA_SECURITY_TEST_ARCHIVE)('installs reproducibly, vendors with integrity, and exercises the remediated MCP server in isolation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rea-security-integration-'));
  const source = path.join(root, 'package');
  const target = `${process.platform}-${process.arch}`;
  const staged = path.join(root, '.runtime-build-security', 'runtime');
  const rea = path.join(staged, 'rea');
  const cache = process.env.REA_SECURITY_NPM_CACHE;
  const npmArgs = cache ? ['--cache', cache] : [];
  const client = new Client({ name: 'rea-security-regression', version: '1.0.0' });
  try {
    await execute('tar', ['-xzf', process.env.REA_SECURITY_TEST_ARCHIVE!, '-C', root]);
    await prepareReaSecurityDependencies(source);
    const lockBefore = await readFile(path.join(source, 'package-lock.json'));
    const trees: string[] = [];
    // npm ci removes node_modules and performs a clean install each time.
    for (let run = 0; run < 2; run++) {
      await execute('npm', ['ci', '--offline', '--omit=dev', '--include=optional', '--ignore-scripts', '--no-audit', ...npmArgs], { cwd: source, maxBuffer: 4 * 1024 * 1024 });
      await verifyReaSecurityDependencies(source);
      const result = await execute('npm', ['ls', '--all', '--omit=dev', '--json', ...npmArgs], { cwd: source, maxBuffer: 4 * 1024 * 1024 });
      trees.push(result.stdout);
      expect(await readFile(path.join(source, 'package-lock.json'))).toEqual(lockBefore);
    }
    expect(trees[1]).toBe(trees[0]);
    await mkdir(path.dirname(rea), { recursive: true });
    await execute(process.execPath, [path.join(project, 'scripts/vendor-engine.mjs'), source], {
      cwd: root, env: { ...process.env, REA_VENDOR_DESTINATION: rea }
    });
    await verifyReaSecurityDependencies(rea);
    const cli = path.join(rea, 'scripts', 'rea.mjs');
    expect((await execute(process.execPath, [cli, '--version'], { cwd: root })).stdout).toContain('6.7.0');
    createRequire(path.join(rea, 'package.json'))('@lydell/node-pty');

    const transport = new StdioClientTransport({ command: process.execPath, args: [cli, '--mcp'], cwd: root, stderr: 'pipe' });
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    expect(tools.length).toBeGreaterThan(200);
    expect(new Set(tools.map(tool => tool.name)).size).toBe(tools.length);
    for (const tool of tools) expect(tool.inputSchema.type).toBe('object');
    for (const [name, args] of [['list_unknowns', { limit: 1 }], ['get_evidence_bundle', { detail: 'summary' }]] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, `${name}: ${JSON.stringify(result)}`).not.toBe(true);
      expect(result.content).toBeDefined();
    }
    const invalid = await client.callTool({ name: 'list_unknowns', arguments: { limit: 'invalid' } }).catch(() => ({ isError: true }));
    expect(invalid.isError).toBe(true);
    await client.close();

    const node = path.join(staged, 'node', target);
    const executable = path.join(node, process.platform === 'win32' ? 'node.exe' : 'bin/node');
    await mkdir(path.dirname(executable), { recursive: true });
    await copyFile(process.execPath, executable);
    const version = process.env.NODE_RUNTIME_VERSION || '26.8.1';
    const archiveTarget = target === 'win32-x64' ? 'win-x64' : target;
    const extension = process.platform === 'win32' ? 'zip' : process.platform === 'linux' ? 'tar.xz' : 'tar.gz';
    await writeFile(path.join(node, 'distribution.json'), JSON.stringify({ version, target,
      archive: `node-v${version}-${archiveTarget}.${extension}`, sha256: 'b'.repeat(64),
      executableSha256: hash(await readFile(executable)) }));
    const active = path.join(root, 'runtime');
    const baseline = path.join(root, '.runtime-candidates', 'existing', 'runtime');
    for (const directory of [active, baseline]) {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'sentinel'), 'preserve');
    }
    const distribution = JSON.parse(await readFile(path.join(rea, 'distribution.json'), 'utf8'));
    expect(distribution.securityDependencies).toEqual({ 'fast-uri': '3.1.9', zod: '4.6.7', ajv: '8.20.0' });
    const result = await saveRuntimeCandidate({ projectRoot: root, stagedRuntime: staged, target });
    expect((await validatePreparedRuntime(result.candidatePath, target)).valid).toBe(true);
    expect(result.verifiedReaFiles).toBeGreaterThan(6000);
    for (const directory of [active, baseline]) expect(await readFile(path.join(directory, 'sentinel'), 'utf8')).toBe('preserve');
    await writeFile(path.join(result.candidatePath, 'rea', 'node_modules', 'zod', 'package.json'), '{}');
    await expect(validatePreparedRuntime(result.candidatePath, target)).rejects.toThrow('REA integrity mismatch');
    if (process.env.REA_SECURITY_TEST_REPORT) await writeFile(process.env.REA_SECURITY_TEST_REPORT, JSON.stringify({ cleanInstalls: 2, identicalTrees: true, tools: tools.length, validCalls: ['list_unknowns', 'get_evidence_bundle'], invalidInputRejected: true, verifiedReaFiles: result.verifiedReaFiles, nativeModuleLoaded: true }, null, 2));
    console.log(`Security integration: two clean installs; identical trees; ${tools.length} MCP tools; two valid calls; invalid input rejected; ${result.verifiedReaFiles} inventoried files; native module loaded.`);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);
