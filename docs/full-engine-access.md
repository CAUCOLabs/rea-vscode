# Full REA engine access

The unchanged REA 6.7.0 source distribution is bundled with the extension and launches through its original stdio MCP entry point.

## Agent setup

The extension bundles REA 6.7.0, locked production dependencies and Node.js 26.8.1 for each release target. Its bundled Node is preferred; a compatible system runtime (^22.19, ^24.11 or >=26) is only a fallback or explicit override. Run **REA: Set Up REA** to select that optional fallback. `rea.scriptPath` remains an optional absolute override. No separate REA checkout or `npx` fallback is used.

**Copilot / VS Code native MCP:** the extension contributes `rea.engine` and registers `vscode.lm.registerMcpServerDefinitionProvider` with `McpStdioServerDefinition`. In a trusted workspace, enable/start **REA full engine** using VS Code's MCP controls and enable its tools for the agent. The host connects directly to REA; all catalog entries, schemas, annotations, output schemas and results come from REA, with no extension allowlist. The Explorer need not be open. Workspace Trust is checked both when discovering the definition and immediately before resolving it. Native MCP requires VS Code 1.102 or newer. Native agent tool confirmations and organization policies still apply; do not enable blanket auto-approval for dangerous operations.

**Codex:** VS Code MCP providers are not assumed to be Codex providers. Run **REA: Configure Codex MCP**, including from an Extension Development Host with no workspace. Choose an existing local project folder in the folder picker; the command does not open that folder in VS Code or redirect to another window. It validates the configured Node executable and bundled engine path without launching REA, then writes `.codex/config.toml` inside the selected folder. Existing text, comments, unrelated settings and MCP servers remain intact. TOML is parsed before and after adding REA, with `default_tools_approval_mode = "prompt"`. An existing REA definition is opened for manual review and is never replaced. Invalid TOML, concurrent edits, and inline-table layouts that cannot safely accept an appended table are left untouched with an explanatory error. Canceling the picker writes nothing. Codex must trust the selected project to load project configuration. After saving, restart Codex CLI from that folder, or use **Developer: Reload Window** in the VS Code window running Codex for that project. Reloading only the Extension Development Host does not reload Codex in the main window. This uses Codex's supported stdio MCP configuration; there is no fabricated Codex extension API and no tool allowlist. Existing global Codex settings and credentials are untouched. Each host has its own REA process and session: retained evidence and open targets are not shared between Explorer, Copilot and Codex.

Sources checked before implementation:

- [VS Code MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp), together with the installed `@types/vscode` declarations (the installed constructor signature is positional).
- [Official OpenAI Codex MCP documentation](https://developers.openai.com/codex/mcp), including project configuration, CLI/IDE configuration sharing and tool approval options.

## Client and orchestration

`ReaMcpClient.connect` loads every `tools/list` page and retains each complete Tool object. Repeated pagination cursors fail rather than loop. Catalog-change notifications refresh discovery. The last complete catalog survives disconnect; reconnect refreshes it from the new process. Offline catalog entries cannot be called.

`invokeTool` accepts any current catalog name and complete JSON object arguments. It requires an authorization callback for every invocation, checks session continuity across authorization, and forwards arguments unchanged. The configured REA server validates its own complete schema; the extension does not reject unions, references, nested objects or legitimate values using its old editor subset. Caller-supplied SDK request options support cancellation, timeout and maximum total timeout. Calls are not retried automatically, because operations may have side effects.

Results are returned intact: `structuredContent`, content blocks, images, resource links, embedded resources, `isError`, and provenance metadata. `readResource` supports text and base64 blobs when the connected server advertises resources. REA 6.7.0 in this installation advertises tools, prompts and completions, **not resources**; its screenshot is base64 PNG inside structured Evidence and its evidence exporter returns a local artifact path. No resource support is falsely claimed for this server. Local artifact paths are preserved; the client does not silently read arbitrary paths.

**REA: Invoke Any Tool** provides an additional full-catalog execution command with JSON arguments, explicit per-call confirmation, cancellation, and a complete JSON result document. The existing automatic web analyzer and the old Explorer query editor retain their narrower automatic execution policies. Those policies do not restrict the general client or native agent integration.

`TaskOrchestrator` recommends catalog tools for website, browser interaction, desktop, source, binary and reconstruction tasks. These are recommendations, not access restrictions. Callers construct steps using live schemas and prior evidence, supply authorization for each concrete tool/argument pair, and can cancel the sequence. The runner executes sequentially and stops on `isError`; it never retries a mutation. Browser interaction, UI capture, debugger commands, installation, file writes and foreign-code execution require scope-appropriate authorization. Read-only annotations alone do not authorize calls through this layer. This layer supplies a programmable foundation; it does not invent a replacement engine or claim autonomous reconstruction quality.

## Validation results

- **Discovered:** 207 unique tools, with complete input schemas. Complete live catalog and raw results were retained in the temporary audit directory printed by the opt-in test. `rea-catalog-audit.json` records names, schema hashes and individual outcomes without committing 9 MB of contracts or machine paths.
- **Invocable through the interface:** all 207 have an unrestricted dispatch route, subject to authorization, REA validation, target state and dependencies. This is interface coverage, not proof that every backend is operational.
- **Actually invoked:** 13 distinct real REA tools; 10 succeeded, 3 reported explicit prerequisites. An additional deliberately invalid call verified REA argument validation.
- **Successful:** `list_unknowns`, `binary_session`, `analyze_javascript_application`, `inspect_with_objdump`, `inspect_adb_client`, `list_browser_targets`, `inspect_web_page`, `capture_web_screenshot`, `export_evidence_bundle`, `get_evidence_bundle`.
- **Requires an open target:** `inspect_plist` returned `target_unavailable` despite its path argument; no session was opened implicitly.
- **Platform requirement:** `inspect_binary_layout` reported that its initial pwntools artifact profile supports Linux x64 only on this macOS host.
- **Missing dependencies:** `inspect_pcap_client` reported absent `tshark`; it requests Wireshark 4.x `tshark` and `capinfos` on PATH or the corresponding REA command settings.
- **Remaining 194 tools:** not executed. Debuggers, native providers, devices, specific artifact formats and destructive operations were not exercised indiscriminately. Their exact operational availability is unknown.

The real browser test uses only a local HTTP fixture, an isolated Chrome profile, and temporary files. It verifies screenshot byte length and SHA-256 against REA Evidence, and verifies the exported bundle exists. Live tests require an environment that permits REA's macOS ownership helper compilation and subprocess/browser launch. Initial sandbox failures were rerun outside the sandbox; they are not counted as permanent engine limitations.

Transport fixture tests separately cover paginated/compound schemas, unchanged arguments, authorization denial, structured errors, timeout, cancellation, reconnect, binary resource blobs, image blocks and resource links. Provider/configuration tests cover trust and separate Codex setup. These mocked host tests do not replace a real Codex/Copilot UI acceptance test. The extension was not installed/reloaded in either agent host during this validation, so end-to-end agent invocation remains unverified.

Run normal checks:

```sh
npm run check
npm test
npm run build
git diff --check
```

Opt into the real installed engine test (performs explicit temporary fixture operations, including browser launch and evidence export):

```sh
REA_LIVE_SCRIPT=/absolute/path/to/rea/scripts/rea.mjs npm test -- tests/reaLive.test.ts
```
