import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ReaMcpClient } from '../src/mcp/client';
import { bundledNodePath, compatibleNode, detectRuntime, engineScript, initializeEngineRuntime, resolveEngineLaunch, runtimeHelp } from '../src/services/engineRuntime';

const extensionRoot = process.cwd();
afterEach(() => initializeEngineRuntime(''));

it('prefers the target-bundled Node runtime and resolves the packaged engine', async () => {
  initializeEngineRuntime(extensionRoot);
  const launch = await resolveEngineLaunch();
  expect(launch.command).toBe(bundledNodePath(extensionRoot));
  expect(launch.args).toEqual([path.join(extensionRoot, 'runtime/rea/scripts/rea.mjs'), '--mcp']);
  expect(engineScript()).toBe(launch.args[0]);
  expect(await detectRuntime('node', [bundledNodePath(extensionRoot)])).toBe(bundledNodePath(extensionRoot));
});

it('checks supported Node release lines and gives actionable guidance when missing', async () => {
  expect(compatibleNode('v22.19.0')).toBe(true);
  expect(compatibleNode('v24.11.0')).toBe(true);
  expect(compatibleNode('v26.0.0')).toBe(true);
  expect(compatibleNode('v22.18.0')).toBe(false);
  expect(await detectRuntime('node', [process.execPath])).toBe(process.execPath);
  await expect(detectRuntime('node-that-does-not-exist', ['node-that-does-not-exist'])).rejects.toThrow(runtimeHelp);
});

it('starts MCP from the packaged engine and discovers REA tools', async () => {
  initializeEngineRuntime(extensionRoot);
  const launch = await resolveEngineLaunch();
  const client = new ReaMcpClient();
  try {
    await client.connect(launch.command, launch.args);
    expect(client.getTools().length).toBe(207);
    const result = await client.executeReadOnlyTool('list_unknowns', { offset: 0, limit: 1 });
    expect(result.isError).not.toBe(true);
  } finally { await client.disconnect(); }
});

it('loads the platform native PTY module from the packaged REA dependency tree', () => {
  initializeEngineRuntime(extensionRoot);
  expect(createRequire(engineScript())('@lydell/node-pty').spawn).toBeTypeOf('function');
});

it('reports absent optional Wireshark tools without attempting to install them', async () => {
  initializeEngineRuntime(extensionRoot);
  const client = new Client({ name: 'rea-missing-tool-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: bundledNodePath(extensionRoot),
    args: [engineScript(), '--mcp'],
    env: { PATH: '', HOME: tmpdir(), TMPDIR: tmpdir(), TEMP: tmpdir() }
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(207);
    const result = await client.callTool({ name: 'inspect_pcap_client', arguments: {} }, undefined, { timeout: 15_000 });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('Supply Wireshark 4.x tshark and capinfos') })]));
  } finally { await client.close(); }
}, 20_000);

it('does not resolve a missing packaged engine from another checkout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rea-vscode-missing-engine-'));
  try {
    initializeEngineRuntime(root);
    await expect(resolveEngineLaunch(process.execPath)).rejects.toThrow('packaged engine is missing');
  } finally { initializeEngineRuntime(''); await rm(root, { recursive: true, force: true }); }
});
