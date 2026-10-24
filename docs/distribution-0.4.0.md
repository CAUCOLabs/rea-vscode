# Distribution and validation — 0.4.0

## Platform packages

Each VSIX contains the official Node.js 26.8.1 runtime for its VS Code target, REA 6.7.0, the locked production dependency closure, and the `@lydell/node-pty` optional native package installed on a runner matching that target. Windows x64 also carries REA's Windows x64 native control artifact. Optional Frida is excluded. The Node runtime checksum is verified against Node.js's published `SHASUMS256.txt` before extraction.

Supported build targets are macOS arm64, macOS x64, Windows x64 and Linux x64. GitHub Actions builds each package on a matching native runner, runs type checking and the complete automated suite there, verifies the VSIX contents, and retains packages as workflow artifacts for 30 days. The workflow does not publish to the Marketplace or create a GitHub release.

The extension prefers its bundled Node runtime. A compatible system Node.js remains an optional fallback, and a user selected `rea.executable` remains an explicit override. `rea.scriptPath` is still an optional absolute override; empty selects the packaged engine.

## External programs

The extension does not install analysis tools. Browser analysis requires a separately installed Chrome, Chromium or Edge. Packet analysis can use Wireshark `tshark` and `capinfos`. Other REA providers may need Ghidra, Hopper, JADX, APKTool, IDA, ADB, LLDB, Frida integrations or other caller-selected software depending on the tool. Optional Frida itself is not bundled. The full tool catalog remains available even when an optional provider reports its executable missing.

## Checks and platform evidence

Automated tests cover bundled runtime selection, MCP initialization, exact REA tool discovery, a read-only real tool call, the native PTY module load, missing external Wireshark tools, runtime fallback/missing cases, VSIX platform consistency and existing Explorer/provider behavior.

### macOS arm64 (local, earlier artifact)

- `npm run check`: passed.
- `npm test -- --reporter=dot`: 177 passed, 2 skipped.
- `npm run build`: passed.
- VSIX packaging and `scripts/verify_vsix.py`: passed for `darwin-arm64`.
- Installed archive runtime smoke: bundled Node 26.8.1 started with an empty `PATH`; MCP initialized, discovered 207 tools and executed the read-only `list_unknowns` tool. `inspect_pcap_client` returned the expected missing Wireshark guidance.
- `@lydell/node-pty` loaded from the bundled macOS arm64 dependency tree.

The following artifact predates the MCP consolidation. Its checks and hash do not validate the current working tree. Current source validation is recorded in [agent integration verification](agent-integration-verification.md); no new package was built during consolidation.

Earlier VSIX: `rea-vscode-0.4.0-darwin-arm64.vsix` (65.5 MB; SHA-256 `0f0e4768dc091c7f1598f9c04508519687d751b9006e67754640f1631091391d`).

### macOS arm64 installed-extension completion — 2026-10-24

Continued from the existing working tree after inspecting uncommitted changes. Reused the already generated and archive-verified `build/rea-vscode-0.4.0-darwin-arm64.vsix` (68,809,461 bytes; SHA-256 `20014e54f6821e772b50b7c0dc43cb0a045cd329d6b85c1119eaace8666cd44e`). Packaging and archive verification were not repeated. The previous temporary installation was unavailable, so this artifact was installed into `/private/tmp/rea-040-validation/extensions` with isolated user data and an empty test workspace.

The installed-extension smoke passed with exit code 0 on VS Code 1.143.0. Through the installed `rea.diagnostics` command, it invoked the original MCP `list_unknowns` tool with `{ "offset": 0, "limit": 1 }`. The actual response had no error and returned:

```json
{"result":{"items":[],"total":0,"offset":0,"next_offset":null}}
```

Launch assertions verified the installed bundled Node and `runtime/rea/scripts/rea.mjs --mcp`, with no external engine override. The smoke also confirmed 207 unique original tools, registered commands, sidebar opening, and native MCP discovery of REA full engine, REA isolated browser and REA Universal Tool Router with installed bundle paths.

The runner must be copied inside a valid test-driver extension declaring `mcpServerDefinitions` in `enabledApiProposals`, with a concrete compatible `engines.vscode` range and a main entry. Enable that proposal only for the driver. The temporary runner dismissed informational notifications with `notifications.clearAll` so awaited diagnostics notifications could complete. Earlier driver attempts encountered API attribution or notification waits; the final run completed all assertions. No installed extension files were changed.

Final checks: `npm run check`, `npm run build`, `node --check scripts/installed-smoke.cjs` and `git diff --check` passed. Full Vitest: **188 passed, 5 skipped, 0 failed** (18 passed files, 4 skipped files). The five opt-in skips cover router, broad engine, browser lifecycle, web workflow and agent reconstruction audits. A separate live router run using the bundled engine passed **4/4**, including real `list_unknowns` execution. The rebuilt extension, browser and router JavaScript bundles match the installed artifact byte-for-byte.

Evidence is retained in `build/distribution-validation/result.json` and `invocation.json`; the isolated driver and host logs remain under `/private/tmp/rea-040-validation`. This completes the installed-extension MCP invocation gate for macOS arm64. It does not establish authenticated agent invocation or visual layout validation in this isolated profile. Earlier agent confirmations remain separate evidence. No local failing check remains; other desktop platform validation remains a release gate before claiming those targets. Remote, WSL/container and web hosts remain untested. No original REA engine changes, version changes, commits, pushes or publishing were performed.

The `platform-vsix.yml` matrix is configured for macOS arm64, macOS x64, Windows x64 and Linux x64. Only the macOS arm64 runner was exercised for this delivery; the other three targets have not yet run, so no VSIX or compatibility claim is made for them. Their VSIX files become available as workflow artifacts after those jobs execute. VS Code remote, WSL/container and web extension hosts remain untested.

No changes are made to the original REA source checkout or to the user's Codex MCP configuration. REA source is redistributed unchanged under MIT with its LICENSE and third-party notices. REA for VS Code is an unofficial independent integration by CAUCOLabs and is not endorsed by the REA maintainer.
