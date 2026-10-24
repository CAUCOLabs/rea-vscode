# REA website analysis

Open REA, paste a website address, click **Analyze**, then review or export an evidence-linked reconstruction report. REA starts its existing engine connection automatically and uses a separate temporary browser for each analysis. No browser profile, port or tool configuration is required on the main screen.

## Quick start

1. Have a supported Chrome/Chromium installation. REA 6.7.0 is bundled; an existing engine can be selected through the optional script-path override. Complete **REA: Set Up REA** using the main panel button. Existing machine-scoped engine settings are reused. If the engine cannot start, repeat setup or **REA: Verify Installation**, then **Reconnect**. No credentials are needed for the included local fixture.
2. In VS Code, press F5 → **Run REA Extension**, open a trusted workspace and select REA. It connects automatically. Paste a complete HTTP(S) website URL and click **Analyze**.
3. Review **Identified components**, **Observed interactions**, **Resources and technologies**, **Reconstruction readiness** and **Missing information**. Available controls are not represented as tested behavior.
4. **View Analysis** expands the human-readable findings. **Export Report** opens a native Save dialog and writes Markdown only to the chosen destination. **Prepare Reconstruction** prepares an evidence-linked coding-agent brief; it does not build an application or invoke a coding agent. Preparation is disabled when no usable component evidence exists. Export includes the report, proposed specification and explicit unknowns.

Only Web is implemented. GitHub and Desktop App say **Coming soon**, disable analysis, and never start a placeholder workflow.

## Simple local end-to-end test

From the extension repository, start the included non-sensitive fixture:

```sh
python3 -m http.server 3000 --bind 127.0.0.1 --directory tests/fixtures/web-target
```

Launch the extension with F5, wait for **Ready**, paste `http://127.0.0.1:3000/`, and click **Analyze**. REA opens its own browser, selects the loaded page and closes the browser after capturing the report. No manually started debugging browser is needed.

Verify that the report identifies headings, navigation, a search input and the disabled Save control. The fixture has no search implementation or backend, so the report must not claim either works. `/api/items` in its script is only a static candidate. Click **View Analysis**, **Prepare Reconstruction**, and **Export Report**, then inspect the resulting Markdown. Inspect missing information rather than assuming a complete application model.

## Dedicated browser lifecycle

The extension locates Chrome/Chromium (or Edge where explicitly supported) in known installation paths. It creates a private temporary directory, configures any browser-generated downloads inside that directory, and launches the installed executable without a shell, inherited API credentials, or user-supplied flags. It uses headless mode, a fresh `--user-data-dir`, and `--remote-debugging-port=0`. The ephemeral connection is read from that owned profile's `DevToolsActivePort` file; REA never scans or attaches to an existing personal browser. The endpoint is always literal loopback. Downloads, cookies and state are not reused from a personal profile.

These browser primitives are documented by [Chrome Headless](https://developer.chrome.com/docs/automation-and-testing/headless), the [DevTools Protocol documentation](https://chromedevtools.github.io/devtools-protocol/) and [Chrome's dedicated-profile requirement](https://developer.chrome.com/blog/remote-debugging-port). Chromium's [remote debugging server implementation](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/devtools/remote_debugging_server.cc) binds HTTP discovery to loopback. The code also requests loopback explicitly; remote endpoint input from the Webview is rejected.

The browser opens exactly the requested startup URL. Normal page scripts and server redirects can run while the website loads; the extension does not inject JavaScript, click controls, submit forms or crawl links. One loaded page must be available in the new profile. If the URL redirects, REA analyzes the final address and records that redirect behavior itself remains untested. A stable final URL identifies the owned tab; it is not proof that every asynchronous component has finished loading.

The owned process is stopped after success, failure, cancellation, connection changes or extension disposal; only its temporary profile is removed. Unix cleanup signals the owned process group, and Windows uses the owned PID's process tree. A profile is not removed while the owned browser cannot be stopped. If cleanup fails, the UI reports it; forcibly terminated browsers or OS policy may require manual cleanup. User browser processes are never intentionally terminated.

Browser preparation has a 20-second budget. Browser discovery, page inspection and screenshots use `rea.webOperationTimeoutMs` (default 60,000 ms); bundle analysis uses `rea.bundleAnalysisTimeoutMs` (default 300,000 ms). Both are absolute per-request deadlines, configurable from 1 to 3,600,000 ms. Progress does not extend them. There is no separate 105-second workflow timer. A request timeout sends MCP cancellation without closing the connection or retrying. Completed evidence is retained in a partial report if a subsequent operation fails or the server disconnects; explicit cancellation and trust checks still apply. No new browser package or browser binary is downloaded. Custom installation locations, unsupported operating systems, browser policies, sandbox restrictions or missing executable permissions can prevent automatic setup. If no supported executable is found, the main screen gives one action: install Chrome/Chromium and try Analyze again. The native launch and OS cleanup paths still require real platform testing.

## Verified engine operations

The existing REA 6.7.0 source definitions and live input schemas were inspected:

| Operation | Use | Scope |
| --- | --- | --- |
| `list_browser_targets` | Select the owned page by its final exact URL | Exact origin, no arbitrary page selection |
| `inspect_web_page` | Semantic DOM, accessibility roles/labels, declared URLs, resource/script metadata and attach-window network observations | 500 ms; no injected evaluation, clicks, body/header content, console text or storage keys/fingerprints |
| `capture_web_screenshot` | One content-addressed PNG of the current visible viewport, with viewport width/height | No scroll, navigation or page JavaScript execution; image bytes remain in REA Evidence and are not embedded in the exported brief |
| `analyze_web_bundle` | Static route/API/technology candidates from captured JavaScript | 500 ms observation; source-map fetching disabled; no execution of captured code |

These operations have `readOnlyHint: false` because REA accesses CDP and records Evidence in its own session. Captures are passive toward the loaded page; the preceding, explicitly requested browser navigation is a separate owned-browser operation.

The current workflow also checks for the exact `capture_web_screenshot` contract in the live catalog; if missing or incompatible, it reports screenshot evidence as unavailable. Element geometry, computed styles and responsive multi-viewport inspection are not provided by the inspected page and screenshot contracts. The Analyze path lists controls and destinations as evidence, but does not execute clicks or form submission. The separate Explore Interactions action currently captures only an initial scenario state, as described below. Actions that can cause side effects need explicit authorization and a separately bounded workflow.

After Analyze, **Explore Interactions** asks for confirmation and invokes the original `capture_browser_scenario` with a provider-owned browser, one 500 ms `wait_for_timeout` action, and screenshot/DOM/accessibility/URL capture at the end. It displays initial evidence and appends it to Markdown export. It does not currently click, type, submit forms or observe action outcomes. The initial scenario evidence is separate from the main WebReport. When captured before project creation, it is exported as scenario-evidence.json with an evidence ID, bounded DOM/accessibility text and artifact hashes, plus evidence/scenario.png when available. The main evidence.json and brief retain their passive-analysis scope. The scenario's browser lifetime and cleanup belong to REA. Other tools such as `observe_web_session`, `observe_web_execution` and `inspect_web_event_listeners` remain outside this workflow.

## Evidence and reconstruction boundaries

OBSERVED means represented by retained evidence, not necessarily visually measured or functionally tested. INFERRED means a static candidate, even if the provider reports high confidence. UNKNOWN includes inaccessible behavior, attach-limited network activity, truncated/policy-filtered sections and missing backend contracts. PROPOSED labels independent implementation choices, never a claimed copy of hidden implementation details.

Requirements link to finding IDs; findings link to the source tool, Evidence ID and result path. Locally computed SHA-256 hashes identify the received evidence serialization; they do not independently authenticate the engine. Those identifiers, full findings, schemas, raw advanced tool responses and browser connection details live under the closed **Advanced / Developer Tools** section. The primary screen shows a simpler projection without internal provenance identifiers.

If capture fails, REA displays **Analysis incomplete**, disables reconstruction preparation and exports only a diagnostic/limited report. If a useful page snapshot exists but scripts or resources are missing, the report keeps those gaps explicit. A UI brief is not proof of complete reconstruction readiness, backend knowledge, authentication equivalence or pixel fidelity.

## Security and validation

Workspace Trust gates engine startup, browser startup, inspection and export. It is checked before and after asynchronous steps. The installed stable VS Code types expose no trust-revocation event; immediate asynchronous revocation handling therefore remains limited. Connection changes abort in-flight analysis. Reports are held in memory and written only after the user chooses an export destination. The Webview cannot supply executable paths, browser flags, connection endpoints, arbitrary tool names, export paths or report bodies.

The restrictive nonce-based CSP, validated messages, local allowlists and schema validation remain in place. Untrusted website/tool text is rendered as text, never HTML. Exports escape Markdown data and instruct coding agents to treat external evidence as data, not instructions.

Raw source, storage contents, cookies, DOM attribute values, bodies and header values are not exported. Query values, fragments, recognizable credentials and personal machine paths are removed. Accessibility labels and page titles can contain sensitive prose that pattern redaction cannot recognize; review exports before sharing. Processing remains capped at 5 million characters per response, with per-section limits and explicit omissions in the advanced evidence. No authentication bypass, unrestricted automation or crawling is implemented.

Automated tests cover UI state, coming-soon workflows, startup/reconnect, evidence/readiness projection, controlled analysis/export, browser isolation, bounds, cancellation and cleanup using fixtures/mocks. They do not prove real browser startup, operating-system cleanup, real Extension Development Host layout or capture success. The previous real-engine diagnostic check returned a tool error and correctly produced zero observed findings; a successful live capture with automatic browser setup is still to be verified.

### Screenshot preview and starter project

`capture_web_screenshot` returns a complete MCP Evidence envelope. The extension checks target, base64, PNG signature, byte count and SHA-256 before retaining the PNG in the in-memory analysis model. Analysis details renders that verified image with its Evidence ID, serialization digest and artifact hash. Capture failures retain a sanitized actual diagnostic and never produce an image. Markdown contains references and hashes, not image bytes. Previously generated reports cannot recover discarded bytes; analyze again for a preview.

Prepare Reconstruction still creates the brief. It then reveals **Create Reconstruction Project**, which asks for a parent folder and creates a fresh `rea-reconstruction-…` child. Atomic directory creation and exclusive file writes reject collisions, including symlinks. There is deliberately no overwrite mode. Generated files: `index.html`, `styles.css`, `evidence.json`, `README.md`, `reconstruction-brief.md`, and, only on verified capture, `evidence/viewport.png`. The static UI uses observed accessibility labels and disabled controls; structure and declared destinations remain evidence-linked in JSON. Styling is original. No actions, backend or pixel equivalence are asserted.

Manual fixture check: serve `tests/fixtures/web-target` locally, analyze its URL, open View Analysis, inspect image/provenance (or the actual failure), then Prepare Reconstruction → Create Reconstruction Project. Select a temporary parent folder, open the generated index.html and inspect evidence.json. Repeat creation to verify separate directories and unchanged earlier files. Advanced and its Tool Explorer start closed; search does not expand groups automatically.


## Live workflow validation — 2026-10-23

The original REA 6.7.0 engine was exercised against the included loopback fixture, through analysis, initial scenario capture, reconstruction generation, and browser validation of the generated starter. A separate real scenario click verified its Limitations section link. This did not add interaction actions to the extension. See [the complete workflow validation report](web-workflow-verification.md) for exact tools, evidence, generated files, checks and limitations.


## Coding-agent implementation handoff

Generated projects include `agent-handoff.md`, matching the prompt copied by the existing Generate with AI action. It directs Copilot, Codex or another coding agent to the brief, evidence JSON, source screenshot and optional initial scenario files. The agent implements application code in the generated project and can collect further authorized interaction evidence using the original REA MCP tools. REA does not generate a second application implementation engine. A real Codex reconstruction and source-versus-reconstruction comparison is recorded in [agent reconstruction validation](agent-reconstruction-verification.md). The project is a snapshot at creation; later scenario captures do not silently overwrite an existing project.
