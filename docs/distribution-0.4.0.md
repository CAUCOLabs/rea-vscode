# Distribution and validation — 0.4.0

## Platform packages

Each VSIX contains the official Node.js 26.8.1 runtime for its VS Code target, REA 6.7.0, the locked production dependency closure, and the `@lydell/node-pty` optional native package installed on a runner matching that target. Windows x64 also carries REA's Windows x64 native control artifact. Optional Frida is excluded. The Node runtime checksum is verified against Node.js's published `SHASUMS256.txt` before extraction.

Supported build targets are macOS arm64, macOS x64, Windows x64 and Linux x64. GitHub Actions builds each package on a matching native runner, runs type checking and the complete automated suite there, verifies the VSIX contents, and retains packages as workflow artifacts for 30 days. The workflow does not publish to the Marketplace or create a GitHub release.

The extension prefers its bundled Node runtime. A compatible system Node.js remains an optional fallback, and a user selected `rea.executable` remains an explicit override. `rea.scriptPath` is still an optional absolute override; empty selects the packaged engine.

## External programs

The extension does not install analysis tools. Browser analysis requires a separately installed Chrome, Chromium or Edge. Packet analysis can use Wireshark `tshark` and `capinfos`. Other REA providers may need Ghidra, Hopper, JADX, APKTool, IDA, ADB, LLDB, Frida integrations or other caller-selected software depending on the tool. Optional Frida itself is not bundled. The full tool catalog remains available even when an optional provider reports its executable missing.

## Checks and platform evidence

Automated tests cover bundled runtime selection, MCP initialization, exact REA tool discovery, a read-only real tool call, the native PTY module load, missing external Wireshark tools, runtime fallback/missing cases, VSIX platform consistency and existing Explorer/provider behavior.

### macOS arm64 (local)

- `npm run check`: passed.
- `npm test -- --reporter=dot`: 177 passed, 2 skipped.
- `npm run build`: passed.
- VSIX packaging and `scripts/verify_vsix.py`: passed for `darwin-arm64`.
- Installed archive runtime smoke: bundled Node 26.8.1 started with an empty `PATH`; MCP initialized, discovered 207 tools and executed the read-only `list_unknowns` tool. `inspect_pcap_client` returned the expected missing Wireshark guidance.
- `@lydell/node-pty` loaded from the bundled macOS arm64 dependency tree.

VSIX: `rea-vscode-0.4.0-darwin-arm64.vsix` (65.5 MB; SHA-256 `0f0e4768dc091c7f1598f9c04508519687d751b9006e67754640f1631091391d`).

The `platform-vsix.yml` matrix is configured for macOS arm64, macOS x64, Windows x64 and Linux x64. Only the macOS arm64 runner was exercised for this delivery; the other three targets have not yet run, so no VSIX or compatibility claim is made for them. Their VSIX files become available as workflow artifacts after those jobs execute. VS Code remote, WSL/container and web extension hosts remain untested.

No changes are made to the original REA source checkout or to the user's Codex MCP configuration. REA source is redistributed unchanged under MIT with its LICENSE and third-party notices. REA for VS Code is an unofficial independent integration by CAUCOLabs and is not endorsed by the REA maintainer.
