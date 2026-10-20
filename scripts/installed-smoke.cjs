// Run as VS Code's extension test runner with the VSIX installed in an isolated profile.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vscode = require('vscode');
exports.run = async () => {
  const extension = vscode.extensions.getExtension('CAUCOLabs.rea-vscode');
  assert.ok(extension, 'VSIX must be installed independently of the driver');
  assert.equal(extension.packageJSON.version, '0.4.0');
  assert.ok(!extension.extensionPath.includes('rea-vscode-030-install/driver'));
  await extension.activate();
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  for (const name of ['rea.setup', 'rea.diagnostics', 'rea.connect', 'rea.configureCodex', 'rea.configureCopilot']) assert.ok(commands.includes(name), name);
  const target = `${process.platform}-${process.arch}`;
  const nodeExecutable = process.platform === 'win32' ? `runtime/node/${target}/node.exe` : `runtime/node/${target}/bin/node`;
  for (const relative of ['dist/extension.js', 'dist/browserServer.js', 'media/sidebar.js', 'media/webAnalyzer.js', 'media/rea.svg', 'runtime/rea/scripts/rea.mjs', 'runtime/rea/LICENSE', 'runtime/rea/THIRD_PARTY_NOTICES.md', nodeExecutable]) await fs.access(require('node:path').join(extension.extensionPath, relative));
  await vscode.commands.executeCommand('rea.sidebar.focus');
  const config = vscode.workspace.getConfiguration('rea');
  if (process.env.REA_INSTALL_SMOKE_NODE) await config.update('executable', process.env.REA_INSTALL_SMOKE_NODE, vscode.ConfigurationTarget.Global);
  await config.update('scriptPath', '', vscode.ConfigurationTarget.Global);
  assert.equal(await vscode.commands.executeCommand('rea.connect', true), true, 'Packaged engine handshake and tool discovery');
  await vscode.commands.executeCommand('rea.disconnect');
  const result = { packagedEngineHandshakeVerified: true, bundledNodeRuntimePresent: true, target, version: extension.packageJSON.version, vscode: vscode.version, installed: true, activated: true, commandsRegistered: true, sidebarOpened: true, visualLayoutVerified: false, authenticatedAgentsVerified: false };
  if (process.env.REA_INSTALL_SMOKE_RESULT) await fs.writeFile(process.env.REA_INSTALL_SMOKE_RESULT, JSON.stringify(result, null, 2));
  console.log('REA installed VSIX smoke:', JSON.stringify(result));
};
