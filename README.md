# REA for VS Code — 0.4.0

Inspect websites from VS Code and connect coding agents to the original REA engine, bundled with this extension. This is an independent CAUCOLabs extension, not an official REA release. The original [REA engine](https://github.com/morluto/rea) was created by **morluto**; its source is included unchanged under its MIT license.

## Install without cloning this repository

1. Obtain the VSIX matching your OS and CPU from the distributor you trust: `darwin-arm64`, `darwin-x64`, `win32-x64` or `linux-x64`.
2. In desktop VS Code **1.102 or newer**, open Extensions → **… → Install from VSIX…**, select the file, and reload if prompted. Alternatively run `code --install-extension /path/to/rea-vscode-0.4.0-<platform>.vsix`.
3. Open a trusted workspace, select **REA** in the Activity Bar and click **Set up REA**. You can also run **REA: Set Up REA** from the Command Palette.

You do not need this repository, npm, F5, source edits, or extension development dependencies to install the VSIX. This milestone does not publish to the Marketplace.

## Prerequisites

- No separate Node.js installation is required. Each platform VSIX includes Node.js 26.8.1 and REA 6.7.0. A compatible system Node.js (`^22.19.0 || ^24.11.0 || >=26.0.0`) is an optional fallback if the bundled runtime is unavailable.
- For websites: an installed **Google Chrome, Chromium or Microsoft Edge** compatible with Chrome DevTools Protocol. REA never downloads a browser. Standard system locations are checked; a custom executable path is supported.
- Coding agent integration is optional: install Codex or enable Copilot/MCP separately. Organization policies may disable MCP.

The platform VSIX includes the official Node.js runtime, REA's engine entry point, platform-installed production dependencies, MIT licenses and third-party notices. Browsers, Wireshark/tshark, Ghidra, Hopper and other analysis backends remain optional external dependencies and are not installed by the extension. Optional Frida is excluded.

## First run

The bundled Node runtime and REA engine are selected automatically. **REA: Set Up REA** lets you select an optional system Node fallback and detects a browser or accepts an absolute browser executable path. No Node path needs to be configured for normal use.

Only machine-scoped User Settings are saved:

| Setting | Purpose |
| --- | --- |
| `rea.executable` | Optional Node.js override. Bundled Node.js is preferred; a compatible system Node.js is a fallback. |
| `rea.scriptPath` | Optional absolute path to a custom REA `scripts/rea.mjs`. Empty uses the bundled engine. |
| `rea.browserPath` | Optional absolute Chrome/Chromium/Edge executable; empty detects standard locations. |

For a macOS browser app, select its actual binary under `.app/Contents/MacOS`, not the `.app` directory. Settings can also be edited through VS Code Settings; no source files need editing.

Choose **Verify connection** to run your selected Node and bundled engine, complete the MCP handshake and discover the live catalog. Then optionally configure an agent. **REA: Verify Installation** repeats diagnostics, reconnects the engine and reports missing browser prerequisites. A connection check does not certify every engine provider or tool. Setup never installs packages or uses `npx`.

If startup fails, check **Output → REA**, Workspace Trust, Node version and executable paths. Run setup again after moving Node. Browser failures include actionable messages; remote network policy and browser sandbox constraints may require changes outside the extension.

## Use REA

Paste an HTTP(S) website URL and click **Analyze**. The extension launches a separate headless browser with a temporary profile and loopback debugging port. It passively inspects the page, captures a screenshot and presents findings. **View Analysis**, **Prepare Reconstruction** and **Export Report** expose further results. GitHub Repository Analysis is also available: choose **GitHub**, enter a public `https://github.com/owner/repository` URL, and click **Analyze**. It collects a bounded, commit-pinned static snapshot without authentication or repository execution. **View Analysis** shows structure, languages, declared dependencies, configuration, entry points and architecture evidence. **Export Report** saves Markdown; **Prepare Agent Handoff** writes a fresh evidence folder for Codex or Copilot. See [GitHub repository analysis](docs/github-repository-analysis.md) for coverage and validation. Desktop App analysis remains planned.

The primary screen does not require catalog configuration. **Advanced / Developer Tools** offers dynamic tool discovery, schemas and a narrow read-only query. **REA: Invoke Any Tool** is an advanced command with a separate explicit execution prompt. Catalog size depends on the engine; discovering a tool does not mean its provider is installed or its behavior has been tested.

## Codex

After setup, run **REA: Configure Codex MCP** and choose the local project used by Codex. The extension adds missing `[mcp_servers.rea]` and `[mcp_servers.rea_browser]` entries to that project's `.codex/config.toml`, with absolute paths to installed Node and the extension's bundled engine/browser entry points. Existing definitions, comments, unrelated settings and credentials are preserved. Review an existing definition manually if it needs updating. No global Codex settings are changed.

Trust the project in Codex, then restart Codex CLI there or reload the VS Code window running Codex. Each MCP server owns its own session. After upgrading/moving/uninstalling this extension, review existing browser definitions: generated absolute extension paths can become stale and are deliberately not overwritten automatically. Remove the two tables to regenerate them if appropriate.

Codex uses its own stdio MCP configuration, independent of Copilot's registry. See [official Codex MCP configuration](https://developers.openai.com/codex/mcp/) and [the browser lifecycle guide](docs/codex-browser.md).

## Copilot

Run **REA: Configure Copilot MCP** in the local project used by your Copilot session. This writes workspace-root `.mcp.json` (`mcpServers`) with the resolved absolute Node executable and original REA engine, preserving existing entries. No tool allowlist is installed. Existing REA entries are preserved for review. Start a new Copilot session associated with that project; folderless chats cannot load its configuration. Configuration alone does not verify agent discovery or invocation.

The editor registry is separate: open **MCP: List Servers**. The extension registers **REA full engine**, **REA isolated browser**, and **REA Universal Tool Router** through VS Code's MCP server definition provider. The router exposes three stable tools: `rea_search_tools`, `rea_get_tool_schema`, and `rea_execute_tool`. Search and schema lookup do not execute REA operations. Execution is marked non-read-only/destructive so compatible clients request their normal approval; the original REA engine still validates and enforces its own tool behavior. The full engine and platform-matched Node.js runtime are bundled; no separate REA checkout or Node installation is required. Start the servers and review VS Code's trust prompts. Copilot and MCP must be enabled; the extension does not install Copilot or bypass policy. Execution requires a trusted workspace. Copilot Agent Host sessions read portable MCP configuration independently; editor server startup alone does not establish agent access. See [MCP configuration formats](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) and [VS Code MCP integration](https://code.visualstudio.com/api/extension-guides/ai/mcp).

Codex and other stdio MCP clients can use the router with the same `node <extension>/dist/routerServer.js <extension>/runtime/rea/scripts/rea.mjs` launch pattern. This is an optional server definition; existing Codex MCP configuration is left unchanged. Configure the client to request approval for `rea_execute_tool` calls.

Copilot Agent discovery and a real `list_unknowns` invocation against REA 6.7.0 have been confirmed in the development environment. Codex access has also been verified. See [integration and consolidation verification](docs/agent-integration-verification.md) for the test results and remaining release validation. Machine-local agent launch files are preserved locally and excluded from source control and distribution.

## Automatic agent browser

The bundled `rea_browser` companion exposes two lifecycle tools. An agent calls `acquire_browser` with a URL, passes the returned `cdp_endpoint` and `allowed_origins` to the bundled engine's `list_browser_targets`, and uses the returned target ID for inspection/screenshots. It must collect needed evidence before calling `release_browser` with the returned lease ID. This companion does not modify or proxy the original engine's catalog.

Profiles are created in the operating system temporary directory, never the extension installation or source checkout. Normal release/disconnect cleans owned processes and profiles. An abrupt host/OS crash can leave temporary files or processes; guaranteed cleanup after forced termination is not claimed. Existing user browser profiles are not used.

## Platform and verification limits

The macOS arm64 package has passed local checks and a packaged MCP smoke test. GitHub Actions builds and tests macOS x64, Windows x64 and Linux x64 separately; those targets remain unvalidated until their matrix jobs complete. VS Code remote and web extension hosts are unverified. See [distribution and validation record](docs/distribution-0.4.0.md).

This is a desktop extension. VS Code for the Web, remote SSH/WSL/containers, restricted browser sandboxes and all combinations of engine providers/agents are not validated. The extension prefers the local UI extension host; Node, REA and browser paths must refer to that host. No cross-host path translation is provided. Browser inspection is a point-in-time observation; it does not prove full application behavior or recover original source. Reports may contain target data; review before sharing.

The Webview uses a Content Security Policy and text rendering. Tool output is untrusted. Workspace Trust guards execution; installed VS Code APIs do not provide a trust-revocation event for automatic disconnection. Each integration has separate engine state/evidence. Full catalog exposure is not exhaustive tool validation.

## Build and package (maintainers only)

```sh
npm ci
npm run check
npm test
npm run build
git diff --check
npm run package
npm run verify:vsix
```

`npm run runtime:prepare -- --target <platform>` downloads and checksum-verifies the official Node runtime, installs REA's locked production dependencies on a native runner (including the matching `@lydell/node-pty` binary), and validates its load before packaging. GitHub Actions executes this matrix on native runners and uploads one VSIX per target. `.vscodeignore` includes only distributable files, target Node and curated `runtime/rea`. The VSIX checker validates actual archive contents and checks common path/secret patterns; it is not an exhaustive security audit.

Further implementation notes: [full engine access](docs/full-engine-access.md), [web analyzer](docs/web-target-analyzer.md), [Codex browser](docs/codex-browser.md).

## Credits and licenses

**REA for VS Code**: independent integration, VS Code interface and browser lifecycle companion by CAUCOLabs, under [MIT](LICENSE), Copyright (c) 2026 CAUCO70 / CAUCOLabs.

**Original REA**: created by **morluto**, [github.com/morluto/rea](https://github.com/morluto/rea), MIT, Copyright (c) 2026 morluto. Its source is bundled unchanged; [LICENSE-REA](LICENSE-REA), upstream dependency notices and required licenses are preserved. This is an unofficial, independent extension and is not affiliated with or endorsed by the original maintainer. The extension's license does not replace the engine's license or its dependencies' licenses.

Redistributed JavaScript dependency notices are included in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). Browsers and agent products remain subject to their own licenses and terms.

### Web analysis timeouts (0.3.2)

`rea.webOperationTimeoutMs` defaults to 60,000 ms for discovery, page inspection and screenshots. `rea.bundleAnalysisTimeoutMs` defaults to 300,000 ms for static script analysis. Both accept integer milliseconds from 1 to 3,600,000. Changes apply to subsequent operations. These extension settings are independent of Codex MCP configuration.

Timeout cancels the individual request without disconnecting MCP or retrying it. Completed page and screenshot evidence remains in a partial report. Real transport failures remain visible as disconnected. Diagnostics log fixed stderr categories and timing, never raw stderr or arbitrary protocol error text. See [the 0.3.2 investigation](docs/connection-lifecycle-0.3.2.md) for evidence and limitations.
