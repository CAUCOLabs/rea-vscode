// Run as VS Code's extension test runner with the VSIX installed in an isolated profile.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
exports.run = async vscodeApi => {
  const vscode = vscodeApi ?? require('vscode');
  const extension = vscode.extensions.getExtension('CAUCOLabs.rea-vscode');
  assert.ok(extension, 'VSIX must be installed independently of the driver');
  assert.equal(extension.packageJSON.version, '0.4.0');
  if (process.env.REA_INSTALL_SMOKE_EXTENSIONS) assert.ok(extension.extensionPath.startsWith(require('node:path').resolve(process.env.REA_INSTALL_SMOKE_EXTENSIONS) + require('node:path').sep), 'Must activate the isolated installed VSIX');
  await extension.activate();
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  for (const name of ['rea.setup', 'rea.diagnostics', 'rea.connect', 'rea.configureCodex', 'rea.configureCopilot']) assert.ok(commands.includes(name), name);
  const target = `${process.platform}-${process.arch}`;
  const path = require('node:path');
  const nodeExecutable = process.platform === 'win32' ? `runtime/node/${target}/node.exe` : `runtime/node/${target}/bin/node`;
  for (const relative of ['dist/extension.js', 'dist/browserServer.js', 'dist/routerServer.js', 'media/sidebar.js', 'media/webAnalyzer.js', 'media/rea.svg', 'runtime/rea/scripts/rea.mjs', 'runtime/rea/LICENSE', 'runtime/rea/THIRD_PARTY_NOTICES.md', nodeExecutable]) await fs.access(path.join(extension.extensionPath, relative));
  const extensionBundle = await fs.readFile(path.join(extension.extensionPath, 'dist/extension.js'));
  const analyzerUi = await fs.readFile(path.join(extension.extensionPath, 'media/webAnalyzer.js'));
  const modeMarkers = {
    'Web Analysis': [b('target-web'), b('analysis-results'), b('analyze-target')],
    'GitHub Repository Analysis': [b('target-github'), b('repository-results'), b('analyzeGitHubRepository')],
    'macOS Desktop Application Analysis': [b('target-desktop'), b('desktop-results'), b('discoverDesktopApplications'), b('inspectDesktop')]
  };
  const packagedUi = Buffer.concat([extensionBundle, analyzerUi]);
  for (const [mode, markers] of Object.entries(modeMarkers)) for (const marker of markers) assert.ok(packagedUi.includes(marker), `${mode} implementation marker missing: ${marker}`);
  await vscode.commands.executeCommand('workbench.view.extension.rea');
  const config = vscode.workspace.getConfiguration('rea');
  if (process.env.REA_INSTALL_SMOKE_NODE) await config.update('executable', process.env.REA_INSTALL_SMOKE_NODE, vscode.ConfigurationTarget.Global);
  await config.update('scriptPath', '', vscode.ConfigurationTarget.Global);
  let connected = false;
  for (let attempt = 0; attempt < 120 && !connected; attempt++) {
    connected = await vscode.commands.executeCommand('rea.connect', true) === true;
    if (!connected) await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(connected, true, 'Packaged engine handshake and tool discovery');
  const tools = await vscode.commands.executeCommand('rea.listTools');
  assert.equal(tools.length, 207, 'Installed extension must discover the complete original catalog');
  assert.equal(new Set(tools.map(tool => tool.name)).size, 207);
  assert.ok(tools.some(tool => tool.name === 'binary_session'));
  assert.ok(tools.some(tool => tool.name === 'list_unknowns'));
  const diagnostic = await vscode.commands.executeCommand('rea.diagnostics');
  assert.equal(diagnostic.engine.toolsDiscovered, 207);
  assert.equal(diagnostic.engine.tool, 'list_unknowns');
  const invocation = diagnostic.engine.invocation;
  assert.notEqual(invocation.isError, true);
  assert.ok(Array.isArray(invocation.structuredContent?.result?.items));
  assert.equal(diagnostic.launch.command, path.join(extension.extensionPath, nodeExecutable), 'Must use the installed bundled Node');
  assert.equal(diagnostic.launch.args[0], path.join(extension.extensionPath, 'runtime/rea/scripts/rea.mjs'), 'Must use the installed bundled engine');
  if (process.env.REA_INSTALL_SMOKE_INVOCATION) await fs.writeFile(process.env.REA_INSTALL_SMOKE_INVOCATION, JSON.stringify(invocation, null, 2));
  // Test-driver-only proposed API: inspect native registry discovery without
  // adding a proposed API dependency to the installed REA extension.
  const deadline = Date.now() + 30000;
  const labels = ['REA full engine', 'REA isolated browser', 'REA Universal Tool Router'];
  const definitions = () => vscode.lm.mcpServerDefinitions ?? [];
  while (!labels.every(label => definitions().some(server => server.label === label)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(labels.every(label => definitions().some(server => server.label === label)), 'Native VS Code registry must discover all three contributed servers');
  const reaDefinitions = definitions().filter(server => labels.includes(server.label));
  for (const definition of reaDefinitions) assert.ok(definition.args[0].startsWith(extension.extensionPath + path.sep), 'Provider must reference installed runtime/bundles');
  await vscode.commands.executeCommand('rea.disconnect');
  const result = { packagedEngineHandshakeVerified: true, toolsDiscovered: tools.length, realTool: 'list_unknowns', invocationVerified: true, nativeMcpDiscoveryVerified: true, nativeServerLabels: reaDefinitions.map(server => server.label), sidebarModesVerified: Object.keys(modeMarkers), launch: diagnostic.launch, installedPath: extension.extensionPath, bundledNodeRuntimePresent: true, target, version: extension.packageJSON.version, vscode: vscode.version, installed: true, activated: true, commandsRegistered: true, sidebarOpened: true, visualLayoutVerified: false, authenticatedAgentsVerified: false };
  if (process.env.REA_INSTALL_SMOKE_RESULT) await fs.writeFile(process.env.REA_INSTALL_SMOKE_RESULT, JSON.stringify(result, null, 2));
  console.log('REA installed VSIX smoke:', JSON.stringify(result));
};
function b(value) { return Buffer.from(value); }
