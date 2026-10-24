# REA for VS Code 0.4.0 — consolidation verification

Date: 2026-10-23. Local platform: macOS arm64. Installed VS Code: 1.143.0; stable extension API target: 1.102.

## Working agent access

The user confirmed that GitHub Copilot Agent discovered and successfully invoked the original REA 6.7.0 `list_unknowns` tool. Copilot integration is working; the earlier “Copilot invocation unverified” limitation is superseded by that confirmation. This consolidation did not initiate another Copilot chat.

Codex agent invocation was repeated during consolidation: the connected REA MCP `list_unknowns` returned `items: []`, `total: 0`, `offset: 0`, `next_offset: null` without an error. The earlier `binary_session` call identified the original engine, version 6.7.0, 207 tools, and aligned server identity. Tools catalog SHA-256: `3d29f2d28a951e67ad8f84eed59e1afa58584d2dd4adf92c7e094f02ffe5e22b`.

A separate real stdio MCP client read the retained project `.mcp.json`, confirmed exact launch parity with `.codex/config.toml` for `rea`, discovered 207 unique tools including `binary_session`, and successfully invoked `list_unknowns`. The launch uses the original engine at `~/Desktop/rea/scripts/rea.mjs` through the configured absolute Node executable. These are real tool calls, not only server-startup checks.

## Earlier root cause

The previous Configure Copilot command only opened the editor MCP server list. The failing session used the Copilot Agent Host (`copilotcli`), a folderless chat root under `~/.copilot/chats/`, and an MCP inventory without REA. Separate editor logs showed REA discovery. Evidence is in the local Code log set `20261023T094911`, especially `agenthost.log` at 10:03:14 and window2's REA server logs.

The [stable provider API](https://code.visualstudio.com/api/extension-guides/ai/mcp) publishes servers to the editor. The [MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) documents Copilot's independent portable configuration and forwarding of eligible editor configurations. The earlier observations do not establish a general forwarding defect.

## Reviewed working-tree changes

| Files | Final purpose |
| --- | --- |
| `src/services/agentIntegration.ts` | Original engine launch uses `--mcp`; Configure Copilot writes portable project `.mcp.json`, preserves existing REA/unrelated entries, validates JSON, checks trust and detects concurrent edits. Codex configuration behavior is retained. |
| `src/services/engineRuntime.ts` | Resolved original/bundled engine launch uses `--mcp`. |
| `src/services/setup.ts` | Existing Copilot command invokes the portable configuration writer. |
| `src/mcp/routerServer.ts` | Router launches the unchanged upstream engine with `--mcp`. |
| `tests/agentIntegration.test.ts` | Correct launch assertions plus configuration merge, trust, concurrency and preservation coverage. |
| `tests/engineRuntime.test.ts`, `tests/browserMcpLive.test.ts`, `tests/reaLive.test.ts` | Test engine launches use `--mcp`. |
| `tests/setup.test.ts` | Mock and assertion cover the actual Copilot configuration function. |
| `tests/sidebar.test.ts` | Correct MCP launch assertion; stale project-created message assertion updated to shipped wording. |
| `tests/sidebarPresentation.test.ts` | DOM fixture now includes the three existing shipped elements `explore-interactions`, `generate-with-ai`, and `scenario-evidence`. No UI implementation changed. |
| `scripts/verify_vsix.py` | Allow and require the already-distributed `dist/routerServer.js`; previously the archive verifier would reject it. |
| `scripts/installed-smoke.cjs` | Require the router bundle in installed-artifact checks. |
| `.gitignore` | Keep this repository's machine-local `.mcp.json` and `.codex/` out of source control; files remain on disk. |
| `README.md` | Explain supported Copilot configuration and verified agent access; link this report. |
| `docs/distribution-0.4.0.md` | Mark earlier archive evidence as historical, not validation of the current source. |
| `docs/agent-integration-verification.md` | Consolidated evidence, cleanup inventory, baseline comparison and release limits. |

No original REA engine files were modified. No new tool implementation or artificial catalog allowlist was introduced. No extension redesign, additional UI, commit, push, or packaging was performed.

## Diagnostic configuration cleanup

- Removed ignored `.vscode/mcp.json`, which contained only the temporary duplicate `rea-test` server.
- Preserved `.mcp.json`: required working Copilot project launch.
- Preserved `.codex/config.toml` byte-for-byte: existing Codex engine and browser configurations.
- Preserved `.vscode/settings.json`: selects the original engine for editor-provider access.
- Preserved `.vscode/launch.json`: normal Extension Development Host launch, not a diagnostic MCP duplicate.
- Preserved the full engine, isolated browser and universal router editor provider registrations.
- Read-only `vsce ls --no-dependencies` confirmed the router bundle is included and none of the machine-local agent/editor configuration files are distributed. It listed 6,105 files and did not create a VSIX.

## Baseline failures and corrections

Before consolidation: 163 passed, 21 failed, 3 skipped. An isolated clean HEAD source snapshot reproduced the exact same 21 failing test names: 20 presentation tests failed on the missing `explore-interactions` DOM element, and one host workflow test expected the obsolete text `Starter project created`. The fixture also lacked the existing `generate-with-ai` and `scenario-evidence` elements.

The baseline run excluded only the MCP runtime-path assertion because the snapshot shared the local runtime by symlink; it recorded 21 passed, 21 failed and 1 skipped. The excluded assertion passed in the real working tree. Baseline failure-name equality was checked programmatically. After fixture/assertion corrections, both sidebar files passed all 43 tests. There were no production sidebar changes.

## Current checks

| Check | Result |
| --- | --- |
| `npm run check` | Passed |
| `npm run build` | Passed |
| Full Vitest suite | 184 passed, 0 failed, 3 skipped |
| Focused integration suite with `REA_LIVE_SCRIPT` pointing at the original engine | 48 passed, 0 failed, 0 skipped |
| Direct client using retained Copilot/Codex launch | 207 unique tools; `list_unknowns` succeeded |
| Connected Codex agent | Real `list_unknowns` invocation succeeded |
| Archive verifier syntax/router inclusion assertions | Passed |
| `node --check scripts/installed-smoke.cjs` | Passed |
| Read-only distribution file listing | Router included; local configurations excluded |
| `git diff --check` | Passed |

The focused suite covers agentIntegration, setup, engineRuntime, routerServer, mcpClient and connectionManager. It includes exactly 207 tools discovered from the bundled engine, a real read-only tool call, and search/schema/execution through the router against the original engine. Missing Wireshark diagnostics return an expected tool error in their dedicated passing test.

The full suite's three skips are the opt-in router, browser and broad engine live audits. The opt-in router test passed in the focused run. The browser and broad engine audits were not rerun during consolidation.

Local JSON reports: `/tmp/rea-consolidation-baseline.json`, `/tmp/rea-consolidation-before.json`, `/tmp/rea-consolidation-integration.json`, `/tmp/rea-consolidation-final.json`. Read-only distribution inventory: `/tmp/rea-consolidation-distribution-files.txt`.

## Remaining release gates

No failing local type, build, unit or focused MCP integration check remains. Copilot access is user-confirmed and Codex access is verified directly. These do not replace release artifact verification:

- A new 0.4.0 archive has intentionally not been built, inspected, installed or smoke-tested with the consolidated changes. The updated archive and installed-smoke checks still need to run against that future artifact.
- Native Windows x64, Linux x64 and macOS x64 validation has not run here; the platform matrix remains necessary before claiming those targets.
- The opt-in browser lifecycle/full engine audits, remote/WSL/container hosts and web extension hosts are outside this consolidation's executed coverage.

The retained local agent configurations intentionally reference this machine's original checkout. Generated user configurations resolve the extension's bundled engine by default and are not distributed as these local files.
