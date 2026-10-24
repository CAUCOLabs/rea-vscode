import { engineScript, resolveEngineLaunch } from './engineRuntime';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { parse } from 'smol-toml';

export function launchConfiguration(executable: string, scriptPath: string) {
  executable = executable.trim(); scriptPath = scriptPath.trim();
  if (!executable) throw new Error('REA executable cannot be empty.');
  if (scriptPath && !path.isAbsolute(scriptPath)) throw new Error('REA scriptPath must be absolute.');
  return { command: executable, args: [engineScript(scriptPath), '--mcp'] };
}

export function codexConfiguration(command: string, args: string[]) {
  // JSON basic strings/arrays are valid TOML for these values. Never install a tool allowlist.
  return `[mcp_servers.rea]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\nstartup_timeout_sec = 60\ntool_timeout_sec = 300\ndefault_tools_approval_mode = "prompt"\n`;
}

// Resolve commands without a shell or starting REA. Persist an absolute command
// so Codex does not depend on the Extension Host's working directory or PATH.
export async function validateCodexLaunch(executable: string, scriptPath: string) {
  const launch = launchConfiguration(executable, scriptPath);
  const resolveCommand = async (command: string) => {
    if (/[\x00-\x1f\x7f]/.test(command) || (!path.isAbsolute(command) && /[\\/]/.test(command))) throw new Error('REA executable must be an absolute path or a command on PATH.');
    const extensions = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
    const candidates = path.isAbsolute(command) ? [command] : (process.env.PATH || '').split(path.delimiter).filter(dir => path.isAbsolute(dir)).flatMap(dir => [path.join(dir, command), ...extensions.filter(Boolean).map(ext => path.join(dir, command + ext))]);
    for (const candidate of candidates) {
      try {
        if (!(await stat(candidate)).isFile()) continue;
        await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(candidate)) continue;
        return candidate;
      } catch { /* Try the next PATH entry. */ }
    }
    throw new Error(`REA executable was not found or is not executable: ${command}. Check REA Settings.`);
  };
  await resolveCommand(executable.trim());
  if (/[\x00-\x1f\x7f]/.test(launch.args[0]) || !(await stat(launch.args[0])).isFile()) throw new Error('REA engine script must reference an existing readable file.');
  await access(launch.args[0], constants.R_OK);
  return { ...launch, command: await resolveCommand(launch.command) };
}

export function mergeCodexConfiguration(existing: string, command: string, args: string[]): string | undefined {
  // Parse both documents; regex matching cannot distinguish quoted/dotted keys,
  // comments, multiline strings or inline tables. Existing REA stays untouched.
  const config = parse(existing);
  const servers = config.mcp_servers;
  if (servers !== undefined && (!servers || typeof servers !== 'object' || Array.isArray(servers))) throw new Error('Existing mcp_servers must be a TOML table.');
  if (servers && Object.hasOwn(servers, 'rea')) return undefined;
  const merged = existing + (existing.endsWith('\n') ? '\n' : '\n\n') + codexConfiguration(command, args);
  try { parse(merged); }
  catch { throw new Error('Existing MCP configuration uses a layout that cannot be safely extended automatically. Existing settings were preserved; add REA manually.'); }
  return merged;
}

export function mergeAgentConfiguration(existing: string, command: string, args: string[], browserScript: string, browserNode = 'node', browserPath = ''): string | undefined {
  const config = parse(existing);
  const servers = config.mcp_servers;
  if (servers !== undefined && (!servers || typeof servers !== 'object' || Array.isArray(servers))) throw new Error('Existing mcp_servers must be a TOML table.');
  let result = existing;
  if (!servers || !Object.hasOwn(servers, 'rea')) result = mergeCodexConfiguration(result, command, args)!;
  if (!servers || !Object.hasOwn(servers, 'rea_browser')) {
    result += `\n[mcp_servers.rea_browser]\ncommand = ${JSON.stringify(browserNode)}\nargs = ${JSON.stringify(browserPath ? [browserScript, '--browser-executable', browserPath] : [browserScript])}\nstartup_timeout_sec = 60\ntool_timeout_sec = 60\ndefault_tools_approval_mode = "prompt"\n`;
  }
  try { parse(result); } catch { throw new Error('Existing MCP configuration cannot be safely extended. Add rea_browser manually.'); }
  return result === existing ? undefined : result;
}

// Copilot's Agent Host reads portable workspace configuration independently of
// the editor MCP registry. Preserve existing server entries, including REA.
export function mergeCopilotConfiguration(existing: string, command: string, args: string[]): string | undefined {
  const config = JSON.parse(existing || '{}');
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Copilot configuration must be a JSON object.');
  const servers = config.mcpServers;
  if (servers !== undefined && (!servers || typeof servers !== 'object' || Array.isArray(servers))) throw new Error('mcpServers must be an object.');
  if (servers && Object.hasOwn(servers, 'rea')) return undefined;
  config.mcpServers = { ...servers, rea: { command, args } };
  return JSON.stringify(config, null, 2) + '\n';
}

export async function configureCopilot() {
  if (!vscode.workspace.isTrusted) throw new Error('REA requires a trusted workspace.');
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) throw new Error('Open a local project folder before configuring Copilot. Folderless Agent Host chats cannot read project MCP configuration.');
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Project used by the Copilot session' });
  if (!folder || folder.uri.scheme !== 'file') throw new Error('Open a local project folder before configuring Copilot. Folderless Agent Host chats cannot read project MCP configuration.');
  const config = vscode.workspace.getConfiguration('rea');
  const { command, args } = await resolveEngineLaunch(config.get('executable', 'node'), config.get('scriptPath', ''));
  const target = vscode.Uri.joinPath(folder.uri, '.mcp.json');
  const read = async () => {
    try { return Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8'); }
    catch (error) { if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return undefined; throw error; }
  };
  const existing = await read();
  const merged = mergeCopilotConfiguration(existing ?? '', command, args);
  if (merged !== undefined) {
    if (!vscode.workspace.isTrusted) throw new Error('REA requires a trusted workspace.');
    if (await read() !== existing) throw new Error('Copilot configuration changed. Retry; no settings were written.');
    await vscode.workspace.fs.writeFile(target, Buffer.from(merged));
  }
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
  await vscode.window.showInformationMessage(merged === undefined
    ? 'Existing Copilot REA configuration preserved. Review it in .mcp.json. Agent discovery and invocation have not been verified.'
    : 'REA full engine configured in .mcp.json for Copilot sessions using this project. Start a new session in this folder and review its MCP trust prompts. Agent discovery and invocation have not been verified.');
}

export function registerAgentIntegration(context: vscode.ExtensionContext) {
  const browserScript = () => context.asAbsolutePath('dist/browserServer.js');
  const routerScript = () => context.asAbsolutePath('dist/routerServer.js');
  const changed = new vscode.EventEmitter<void>();
  const launch = () => {
    const config = vscode.workspace.getConfiguration('rea');
    return launchConfiguration(config.get('executable', 'node'), engineScript(config.get('scriptPath', '')));
  };
  context.subscriptions.push(changed,
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('rea')) changed.fire(); }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => changed.fire()));
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider === 'function') {
    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('rea.engine', {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: () => {
        if (!vscode.workspace.isTrusted) return [];
        const { command, args } = launch();
        const browserPath = vscode.workspace.getConfiguration('rea').get<string>('browserPath', '');
        const enginePath = args[0];
        return [new vscode.McpStdioServerDefinition('REA full engine', command, args, {}, JSON.stringify([command, args])),
          new vscode.McpStdioServerDefinition('REA isolated browser', command, browserPath ? [browserScript(), '--browser-executable', browserPath] : [browserScript()], {}, JSON.stringify([command, browserPath, browserScript()])),
          new vscode.McpStdioServerDefinition('REA Universal Tool Router', command, [routerScript(), enginePath], {}, JSON.stringify([command, routerScript(), enginePath]))];
      },
      resolveMcpServerDefinition: definition => {
        if (!vscode.workspace.isTrusted) throw new Error('REA requires a trusted workspace.');
        const config = vscode.workspace.getConfiguration('rea');
        // VS Code resolves definitions at start time. Resolve PATH/version here
        // so agents receive an absolute compatible Node executable, even when
        // their MCP launcher does not inherit the Extension Host's PATH.
        return resolveEngineLaunch(config.get('executable', 'node'), config.get('scriptPath', '')).then(({ command }) => {
          if (!vscode.workspace.isTrusted) throw new Error('REA requires a trusted workspace.');
          if (definition instanceof vscode.McpStdioServerDefinition) definition.command = command;
          return definition;
        }).catch(async error => {
          const detail = error instanceof Error ? error.message : 'No compatible Node.js runtime was found.';
          const action = await vscode.window.showErrorMessage(`REA MCP could not start. ${detail}`, 'Set up REA');
          if (action === 'Set up REA') await vscode.commands.executeCommand('rea.setup');
          throw error;
        });
      }
    }));
  }
  context.subscriptions.push(vscode.commands.registerCommand('rea.configureCodex', async () => {
    try {
      if (!vscode.workspace.isTrusted) throw new Error('REA requires a trusted window.');
      // Folder selection does not open a workspace or redirect to another window.
      const selected = await vscode.window.showOpenDialog({
        title: 'Choose an existing project folder for Codex MCP',
        openLabel: 'Configure Codex here', canSelectFolders: true,
        canSelectFiles: false, canSelectMany: false,
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
      });
      if (!selected?.[0]) return;
      const folder = selected[0];
      if (folder.scheme !== 'file' || (await vscode.workspace.fs.stat(folder)).type !== vscode.FileType.Directory) throw new Error('Select an existing local project folder.');
      const config = vscode.workspace.getConfiguration('rea');
      const { command, args } = await resolveEngineLaunch(config.get('executable', 'node'), config.get('scriptPath', ''));
      const directory = vscode.Uri.joinPath(folder, '.codex');
      const target = vscode.Uri.joinPath(directory, 'config.toml');
      let existing = '';
      let existed = false;
      try { existing = Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8'); existed = true; }
      catch (error) { if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error; }
      const merged = mergeAgentConfiguration(existing, command, args, browserScript(), command, config.get('browserPath', ''));
      if (merged === undefined) {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
        void vscode.window.showWarningMessage('This project already defines mcp_servers.rea and mcp_servers.rea_browser. Existing settings were preserved. Edit that table manually if needed, then reload Codex in the window using this project.');
        return;
      }
      if (!vscode.workspace.isTrusted) throw new Error('REA requires a trusted window.');
      // Detect edits made while validation/reads were pending, rather than replacing them.
      try {
        const current = Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8');
        if (!existed || current !== existing) throw new Error('Codex configuration changed. Retry; no settings were written.');
      } catch (error) {
        if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound' || existed) throw error;
      }
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(target, Buffer.from(merged));
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
      void vscode.window.showInformationMessage('REA MCP configured in the selected project. Codex must trust this project to load .codex/config.toml. Restart Codex CLI in that folder, or reload the VS Code window running Codex for that project (Developer: Reload Window). Reloading only this Extension Development Host does not reload Codex in another window.');
    } catch (error) {
      void vscode.window.showErrorMessage(`REA: ${error instanceof Error ? error.message : 'Unable to configure Codex MCP.'}`);
    }
  }));
}
