# GitHub Repository Analysis — 0.4.0

## Using the sidebar

Select **GitHub**, enter a public repository URL such as `https://github.com/expressjs/express`, and click **Analyze** in a trusted workspace with REA connected. The existing URL field, analysis action, progress display and result styling are reused. GitHub no longer displays Coming soon. Desktop App remains unavailable. Switching modes retains each mode's report and URL; Web Analysis and reconstruction controls retain their existing workflow.

**View Analysis** exposes the structured Markdown report in the sidebar. **Export Report** saves that report to a selected Markdown file. **Prepare Agent Handoff** asks for a parent folder and creates a fresh `rea-repository-…` child containing:

- `repository-analysis.md`: languages, framework candidates, dependency declarations, configuration locations, entry points, architecture observations/inferences/unknowns, original REA summary/module evidence, inventory and coverage limits.
- `repository-evidence.json`: pinned commit/tree, inventoried paths/modes/Git object identities, selected source/configuration contents, Git blob SHA-1 and content SHA-256, and unchanged REA responses.
- `agent-handoff.md`: instructions for Codex or Copilot to consume the evidence, cite sources and collect further authorized evidence using existing REA/Git/GitHub tools.

The handoff document opens in the editor. Give it and the evidence folder to your existing Codex or Copilot session. This does not create a new agent implementation, submit a chat, change existing MCP configuration, or perform code modifications. Implementation remains the coding agent's responsibility after the user requests a change. The folder contains evidence rather than a runnable checkout.

## Architecture and reused tools

`ReaSidebarProvider` still owns trusted host actions, progress, report state, export dialogs and lifecycle cancellation. Its strict sidebar protocol admits only the new repository URL and fixed action names; filesystem destinations and tool names never come from webview messages. The original web workflow, reconstruction agent handoff and advanced Tool Explorer are retained.

`githubRepository.ts` uses Node's built-in HTTPS client and GitHub's existing public REST endpoints. It reads metadata, resolves the default branch to one commit/tree, reads the recursive tree, then downloads selected blobs by Git object ID. It verifies each blob's Git SHA-1 and records SHA-256 before decoding strict UTF-8. This avoids cloning, Git hooks, package installation and archive extraction. It sends no authorization header, does not consult Git credentials, and never follows redirects. Renamed repositories require their current canonical URL. See GitHub's official [Git trees](https://docs.github.com/en/rest/git/trees?apiVersion=2022-11-28) and [Git blobs](https://docs.github.com/en/rest/git/blobs?apiVersion=2022-11-28) contracts.

`githubRepositoryAnalyzer.ts` organizes inventory and manifest facts. It uses the existing `smol-toml` dependency for TOML; no dependency was added. JavaScript sources are written as inert files into a fresh temporary directory and passed through the existing `ReaMcpClient.invokeTool` authorization boundary to the original REA 6.7.0 `analyze_javascript_application` with explicit `source_paths`, `format: directory`, `integrity_policy: fail` and `detail: summary`. A bounded `inspect_analysis_view` module page uses the same-session parent evidence identity returned by that call. No repository-selected tool or command is invoked. REA's original catalog and engine are unchanged.

REA responses are preserved unchanged because rewriting evidence would invalidate its identity. Temporary analysis files are removed in a `finally` block. REA's inventory and coverage describe only those materialized selected files; they must not be mistaken for complete repository coverage. Parent evidence references are valid only in their originating MCP session. The JSON handoff retains the received summary/module pages and captured source bytes independently of that session.

`repositoryHandoff.ts` follows the existing reconstruction export's fresh-directory and exclusive-write pattern. Repository paths are JSON evidence and cannot choose handoff output paths. Source content, README text, scripts and provider output are treated as untrusted evidence. All repository content is rendered with text nodes, not injected HTML.

## Implemented coverage and limits

- Public `https://github.com/owner/repository` URLs, optionally ending in `.git` or `/`. Credentials, alternate hosts/protocols/ports, query strings, fragments and branch/file URLs are rejected. Analysis selects the default branch and pins its resolved commit.
- Inventory: up to 20,000 tree entries, with truncation explicitly reported. Symlinks, submodules, LFS targets and unsafe or case-colliding paths are never materialized. No arbitrary local checkout is inspected.
- Retrieval: at most 24 blob requests, 256 KiB/file and 2 MiB total selected file bytes; request response sizes and deadlines are bounded. The overall analysis deadline is 180 seconds. Root configuration and production sources precede example/test entry points. Large, binary and non-UTF-8 files are excluded from source analysis. The inventory still lists nonselected files.
- Languages: file-extension counts from inventory, not GitHub Linguist byte percentages. Generated/vendor files may contribute to counts.
- Dependencies: declared direct/development/peer/optional dependencies in `package.json`, Python `pyproject.toml`/Poetry and requirements, Rust `Cargo.toml`, `go.mod`, and PHP `composer.json`. Other recognized configuration and lockfiles are captured within budgets for agent review. No complete resolved/transitive dependency graph or vulnerability audit is claimed.
- Frameworks: candidates inferred from a limited set of dependency names, not proof of runtime use. Entry points distinguish manifest declarations from filename-based candidates. Manifest locations indicate possible package/service boundaries, with runtime architecture left unknown.
- REA: selected JavaScript `.js`, `.mjs`, `.cjs` and `.jsx` sources use original static analysis. Non-JavaScript repositories still receive inventory/configuration/dependency evidence. TypeScript and other language semantics are not claimed. Missing contracts or REA failures are explicitly marked while retaining usable repository evidence.
- Network errors, public API rate limits/denials, renamed/private/missing/empty repositories, invalid API JSON, object-identity mismatches, oversized responses, timeouts and cancellation surface through the existing progress UI. Connection changes and view disposal abort repository work; authorization is rechecked before invoking REA or presenting a report.

No build, install, test, configuration script or application from the repository runs. Dynamic behavior, complete call graphs, backend services and deployment topology require further authorized evidence. Public API quotas can require waiting before another analysis; no authentication is required or requested by this feature.

## Files changed for this feature

| File | Purpose |
| --- | --- |
| `src/services/githubRepository.ts` (new) | Public fixed-origin retrieval, URL/path checks, pinned inventory, verified bounded blobs |
| `src/analysis/githubRepositoryAnalyzer.ts` (new) | Manifest/language evidence, original REA calls, report and module-fact projection |
| `src/services/repositoryHandoff.ts` (new) | Fresh evidence-only Codex/Copilot handoff folder |
| `src/views/reaSidebarProvider.ts` | GitHub results/actions, host validation, cancellation, export and handoff |
| `src/views/sidebarProtocol.ts` | Strict repository URL/export/handoff messages |
| `media/webAnalyzer.js` | Enable GitHub mode, URL/report state and action handlers |
| `media/sidebar.css` | Apply existing result spacing and wrapping to the repository result |
| `tests/githubRepository.test.ts` (new) | Retrieval, analysis, handoff and report safety regression tests |
| `tests/githubRequest.test.ts` (new) | HTTP/auth/redirect/error/limit/timeout tests |
| `tests/githubRepositoryLive.test.ts` (new) | Opt-in real public GitHub and bundled REA integration |
| `tests/sidebar.test.ts` | Host repository workflow, export, trust, errors and disconnect regression tests |
| `tests/sidebarPresentation.test.ts` | GitHub mode, safe report rendering and handoff actions; retain Desktop placeholder |
| `README.md` | Discoverable GitHub workflow and documentation link |
| `docs/github-repository-analysis.md` (new) | Architecture, usage, limits and validation record |

Other pre-existing uncommitted changes were retained. No original REA, package version, dependency manifest or lockfile changes were made by this feature.

## Real public repository validation — 2026-10-24

The opt-in `REA_GITHUB_LIVE=1 npx vitest run tests/githubRepositoryLive.test.ts --reporter=verbose` passed on macOS arm64 with the unchanged bundled Node and REA engine:

| Check | Result |
| --- | --- |
| Repository | `https://github.com/expressjs/express` |
| Pinned commit | `1c6f1b0fe4000977b9a7b4f34097e4d527dd9824` |
| Pinned tree | `9190596cea9d129e1c3230a6527f8ca8f996dfbd` |
| Inventory | 284 files/directory entries |
| Captured files | 24, including `package.json`, `index.js`, and core `lib/application.js`, `lib/express.js`, `lib/request.js`, `lib/response.js`, `lib/utils.js`, `lib/view.js` |
| Language counts | JavaScript 142, HTML 8, CSS 4 |
| Dependency declarations | 44, including `router` |
| Entry declarations/candidates | 32 |
| Original REA | Static summary and bounded module page captured successfully |
| Tool catalog | 207 original tools discovered |
| Handoff | Markdown, JSON evidence and Codex/Copilot prompt written and read back; commit and core captured source verified |
| Public GitHub reads | 27 analysis requests, no authentication; a separate missing-repository request produced the expected error |

The first network attempt was sandbox-blocked. With network access allowed, the first analysis exposed selection crowding by example entry files; a production-source prioritization correction and regression test fixed it. The final real network run passed all assertions. No repository code was executed. The test validates service retrieval and analysis plus evidence handoff, not an authenticated coding-agent conversation.

Machine-local evidence is retained under `build/github-repository-validation/`: `validation.json`, `report.json`, `repository-analysis.md`, recorded public API responses, and the generated `rea-repository-…` evidence folder. These files are ignored build artifacts and are not distributed. The recorded responses also permit offline inspection without spending additional public API quota.

Automated coverage includes URL rejection before network access, portable path restrictions, pinned reads and blob integrity, symlink/submodule/collision exclusion, size/request budgets, production source priority, dependency extraction, REA failure retention, non-JavaScript coverage, authorization/cancellation, temporary-directory cleanup, unchanged provider responses, evidence-only handoff creation, strict messages, host progress/export behavior, text-only report rendering and retained Web/Desktop mode behavior. HTTP transport tests cover fixed-origin/no-auth requests, 404/403/429/409/redirect/server errors, response limits, malformed JSON, cancellation and deadlines.

Final source checks: `npm run check`, `npm run build`, JavaScript syntax checks and `git diff --check` passed. Full suite: **237 passed, 0 failed, 6 opt-in skipped** across 20 passed test files and 5 skipped files. The six opt-in skips are the broad engine, router, browser lifecycle, web workflow, agent reconstruction and public repository live audits. The public repository audit passed separately as described above. The final JSON test report is `build/github-repository-validation/final-tests.json`.

The final human-readable module projection and Markdown-safe export were also generated from the captured live evidence without another GitHub download. The final handoff JSON was read back and checked for commit parity and unchanged REA summary/module responses. `validation.json` points to that final evidence folder.

 The pre-existing 0.4.0 VSIX predates this GitHub feature; it has not been rebuilt or reinstalled for this task. Source build/type checks and the bundled engine were exercised on macOS arm64. Windows/Linux/macOS x64, remote/web hosts and a new release artifact remain outside this feature's executed validation.
