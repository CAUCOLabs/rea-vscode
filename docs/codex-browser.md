# Codex browser lifecycle

The extension ships a **separate MCP stdio server**, `rea_browser`, alongside
`rea`. It reuses `startAnalysisBrowser`, the same lifecycle used by the Web
Analyzer. It does not proxy, filter, or modify the REA engine or its catalog.
`ReaMcpClient` continues to validate discovered contracts; `TaskOrchestrator`
continues to invoke engine tools. Neither owns this independent agent session.

## Setup

Install the VSIX, complete **REA: Set Up REA**, run **REA: Configure Codex MCP**, and select
the project used by Codex. This adds missing `rea` and `rea_browser` tables to
`.codex/config.toml`, preserving existing tables and other settings. Trust the
project and restart Codex CLI there, or reload the window running Codex.
VS Code MCP consumers also receive a separate “REA isolated browser” definition.

The companion runs the bundled `dist/browserServer.js` using the configured,
installed Node.js executable. An extension move/update can change that
absolute path; existing tables are preserved, so update the companion's path
manually if necessary. For an installed extension, manual equivalent (use its actual installed path):

```toml
[mcp_servers.rea_browser]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/rea-vscode/dist/browserServer.js"]
startup_timeout_sec = 60
tool_timeout_sec = 60
```

This is a standard additional MCP server configuration, supported by
[Codex MCP documentation](https://developers.openai.com/codex/mcp/).

## Agent procedure

1. On `rea_browser`, call `acquire_browser({"url":"https://example.com/"})`.
   It returns `lease_id`, `cdp_endpoint`, `target_url`, and `allowed_origins`.
2. On the **REA engine**, call `list_browser_targets` with the returned
   `cdp_endpoint` and `allowed_origins`. Obtain `target_id` from its result.
3. Invoke live-discovered REA tools such as `inspect_web_page` or
   `capture_web_screenshot` with that endpoint, origins, and target ID. Follow
   each tool's actual input schema. Preserve/export needed evidence.
4. On `rea_browser`, call `release_browser({"lease_id":"<returned id>"})`
   in a finally/cleanup step, including when inspection fails.

`acquire_browser` and `release_browser` are extension tools, **not REA tools**.
REA's browser contract requires an existing debugging endpoint; its
`docs/browser-observation.md` explicitly says REA does not launch, own, or
terminate the browser and does not read `DevToolsActivePort` for you.

## Ownership and limits

Each acquisition gets a new headless Chrome/Chromium-family process, a private
`rea-analysis-*` temporary profile, and an OS-allocated port (`port=0`) bound to
127.0.0.1. Discovery reads only that profile's `DevToolsActivePort` and waits
for a single stable HTTP(S) page. Redirects determine the returned final origin.
No user profile, supplied PID, supplied endpoint, shell command, or custom
browser flags are accepted. Releases stop only the dedicated process group
(or its owned Windows process tree), then remove its profile. Concurrent
leases are independent; unknown lease IDs cannot close anything.

Leases stay alive until explicit release or companion shutdown (stdio EOF,
SIGINT, SIGTERM). Shutdown cancels pending startups and closes acquired leases.
An abrupt SIGKILL/host crash cannot run cleanup and may leave temporary files
or a process; never use broad browser-kill commands to clean these up.
There is no idle timeout. CDP is unauthenticated loopback access: other local
processes may access the port. A supported installed browser and a local
runtime able to launch it are required. Authenticated normal-browser sessions
are deliberately unavailable in the fresh profile. HTTP(S) URLs only.

## Validation

`npm test` covers discovery, startup errors, cancellation, cleanup, separate
concurrent leases, foreign lease protection, MCP contracts and configuration
preservation. The opt-in end-to-end test uses the built stdio companion,
a local HTTP fixture, installed Chrome and a real REA engine:

```sh
npm run build
REA_BROWSER_LIVE_SCRIPT=/absolute/path/to/rea/scripts/rea.mjs npm test -- tests/browserMcpLive.test.ts
```

It calls `list_browser_targets`, `inspect_web_page`, and
`capture_web_screenshot`, checks evidence and verifies the released debugging
endpoint is unreachable. The engine installation is read/executed only.
