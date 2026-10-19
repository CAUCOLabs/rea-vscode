import * as vscode from 'vscode';
import * as path from 'node:path';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { parse } from 'smol-toml';

export function launchConfiguration(executable: string, scriptPath: string) {
  executable = executable.trim(); scriptPath = scriptPath.trim();
  if (!executable) throw new Error('REA executable cannot be empty.');
  if (scriptPath && !path.isAbsolute(scriptPath)) throw new Error('REA scriptPath must be absolute.');
  return scriptPath ? { command: executable, args: [scriptPath, 'mcp'] }
    : { command: 'npx', args: ['--no-install', 'rea-agents', 'mcp'] };
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
        return candidate;
      } catch { /* Try the next PATH entry. */ }
    }
    throw new Error(`REA executable was not found or is not executable: ${command}. Check REA Settings.`);
  };
  await resolveCommand(executable.trim());
  if (scriptPath.trim()) {
    if (/[\x00-\x1f\x7f]/.test(scriptPath) || !(await stat(scriptPath.trim())).isFile()) throw new Error('REA scriptPath must reference an existing readable file.');
    await access(scriptPath.trim(), constants.R_OK);
  }
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

export function registerAgentIntegration(context: vscode.ExtensionContext) {
  const changed = new vscode.EventEmitter<void>();
  const launch = () => {
    const config = vscode.workspace.getConfiguration('rea');
    return launchConfiguration(config.get('executable', 'node'), config.get('scriptPath', ''));
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
        return [new vscode.McpStdioServerDefinition('REA full engine', command, args, {}, JSON.stringify([command, args]))];
      },
      resolveMcpServerDefinition: definition => {
        if (!vscode.workspace.isTrusted) throw new Error('REA requires a trusted workspace.');
        return definition;
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
      const { command, args } = await validateCodexLaunch(config.get('executable', 'node'), config.get('scriptPath', ''));
      const directory = vscode.Uri.joinPath(folder, '.codex');
      const target = vscode.Uri.joinPath(directory, 'config.toml');
      let existing = '';
      let existed = false;
      try { existing = Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8'); existed = true; }
      catch (error) { if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error; }
      const merged = mergeCodexConfiguration(existing, command, args);
      if (merged === undefined) {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
        void vscode.window.showWarningMessage('This project already defines mcp_servers.rea. Existing REA and other settings were preserved. Edit that table manually if needed, then reload Codex in the window using this project.');
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
