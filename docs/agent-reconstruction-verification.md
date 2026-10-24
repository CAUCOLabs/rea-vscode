# Agent-assisted reconstruction validation — 0.4.0

Date: 2026-10-23. Platform: macOS arm64. Target: the existing non-sensitive `tests/fixtures/web-target` on ephemeral loopback ports. The original REA 6.7.0 engine was used directly with `--mcp`; all 207 tools remained available.

## Outcome and architecture

The Codex coding agent in this conversation successfully implemented a separate generated project from REA evidence and validated its limited observed behavior against the source fixture. The application was written by the coding agent between separate collect and compare test phases. The test and extension did not emit the implementation. This is a controlled simple-fixture demonstration, not a blind benchmark or a claim of general application parity.

The extension continues to capture observations and package evidence. Its existing static starter is a handoff scaffold. Copilot or Codex can read the generated project files, view PNG references, and use an already-configured original REA MCP connection for additional authorized evidence. No new reconstruction engine, agent-specific private API, automatic chat submission or UI was added.

## Small integration improvements

- The generated project now contains persistent `agent-handoff.md`, with the same prompt copied by the existing Generate with AI action. It names the brief, evidence JSON, source screenshot and optional scenario artifacts, assigns implementation to the coding agent, and requests verified/inferred/unknown distinctions and browser comparisons.
- When initial scenario evidence exists at project creation, it is exported as `scenario-evidence.json`, preserving the originating tool/evidence ID, target, initial-only scope, completeness and bounded DOM/accessibility text. It explicitly says `actionsVerified: false`.
- The optional scenario screenshot is exported to `evidence/scenario.png` after PNG-signature/hash verification. Text export digests are computed independently from provider digests so truncation cannot falsely imply byte equality.
- Sidebar project creation passes its retained scenario evidence into the exporter. Existing projects without scenarios remain supported; no files in existing projects are overwritten.

The original full-catalog MCP integrations are unchanged. Generated projects do not copy machine-local MCP credentials/configuration. An agent using a new project window must have the extension/MCP connection configured in that context; this run used the current coding agent and original-engine client. The native clipboard/new-window handoff was tested with VS Code mocks, not by submitting another Copilot conversation.

## Observation and implementation sequence

1. The agent reviewed the existing workflow, brief, evidence JSON and source viewport image.
2. The collect phase called the original REA tools against the source fixture and created `build/agent-reconstruction-validation/rea-reconstruction-agent` using the existing project generator and new evidence export.
3. Original `capture_browser_scenario` recorded real Overview/Items link clicks and enabled search text entry. The agent read the per-step DOM, accessibility and URL evidence from `evidence/source-interactions.json` and the exported initial scenario. Source controls and labels were observed, not invented.
4. The agent outlined the intended native behavior and manually edited only the separate project's `index.html`, `styles.css`, `README.md` and `agent-implementation.md`. The source fixture was not modified. The implementation uses ordinary semantic HTML and native browser behavior; no application JavaScript was needed for the observed interactions.
5. The compare phase replayed the same original REA actions against the source and reconstruction, compared all four accessibility snapshots and URL fragments, and separately inspected both pages' control states and screenshots.

## Exact original REA tools

The retained two-phase demonstration contains 14 original tool calls:

| Tool | Collect phase | Compare phase | Purpose |
| --- | --- | --- | --- |
| `list_browser_targets` | 1 | 2 | Find owned source/reconstruction tabs. |
| `inspect_web_page` | 1 | 2 | Source interface evidence; compare enabled search and disabled Save states. |
| `capture_web_screenshot` | 1 | 2 | Source and reconstruction visual references. |
| `analyze_web_bundle` | 1 | 0 | Bounded static source inspection; no fabricated API/framework conclusions. |
| `capture_browser_scenario` | 2 | 2 | Initial source observation, active source capture, source replay and reconstruction replay. |

The active scenario executes:

1. `initial`: `wait_for_timeout` for 100 ms.
2. `overview`: click the exact accessible link named Overview.
3. `items`: click the exact accessible link named Items.
4. `query`: fill the observed search input with the literal test value `catalog probe`.

DOM, accessibility, URL and screenshot artifacts are requested after each step. Scenario completeness was `complete`, each action completed, and provider-owned browser cleanup was `terminated-owned-process`. The source interaction evidence used for implementation was `ev_22757b7a0399e7534bd175ba3ce36474766c53592ddb2a5f6cb7af706e398480`. Every call's raw result, evidence ID and filename is retained in `collect-tools.json`, `compare-tools.json` and `validation.json` under the build directory.

## Behavior comparison

| Behavior | Result | Scope |
| --- | --- | --- |
| Initial interface semantics | Verified | Accessibility snapshots equal, including headings, labels, landmarks and disabled Save. |
| Overview navigation | Verified | Both reached `#overview`; resulting accessibility snapshots equal. |
| Items navigation | Verified | Both reached `#items`; resulting accessibility snapshots equal. |
| Search text entry | Verified | Both accepted `catalog probe`; resulting accessibility snapshots equal. |
| Search enabled state | Verified | Both original page inspections reported an enabled searchbox. |
| Save disabled state | Verified | Both original page inspections reported `disabled: true`. No save action was claimed. |
| Visual treatment | Inferred implementation choice | Agent used the source screenshot and native browser styling; source/reconstruction screenshots were inspected. Pixel equivalence was not asserted. |
| Filtering, saving, authentication, persistence, backend APIs | Unknown/unimplemented | No such working behavior was established. Candidate strings and visible controls are not backend contracts. |

## Generated and agent-authored files

Project: `build/agent-reconstruction-validation/rea-reconstruction-agent/`.

| File | Origin and purpose |
| --- | --- |
| `index.html` | Agent-authored semantic application with actual source fragment navigation and enabled native text entry. |
| `styles.css` | Agent-authored minimal visual implementation. |
| `README.md` | Agent-authored usage and explicit functionality limits. |
| `agent-implementation.md` | Agent-authored implementation decisions, evidence basis and unknowns. |
| `agent-handoff.md` | Exported persistent coding-agent instructions. |
| `reconstruction-brief.md` | Existing evidence-linked reconstruction brief. |
| `evidence.json` | Existing observed components/navigation/unknowns and screenshot provenance. |
| `scenario-evidence.json` | New portable initial-scenario evidence export. |
| `evidence/viewport.png` | Verified source viewport artifact. |
| `evidence/scenario.png` | Verified initial scenario image artifact. |
| `evidence/source-interactions.json` | Original active scenario captured for this agent validation, additional to the UI's initial-only capture. |
| `source-behavior.md` | Test-run scope and source observation summary. |
| `comparison-results.json` | Executed source/reconstruction assertions and remaining unverified functionality. |

The surrounding ignored build directory contains raw collect/compare tool responses, `source-report.json`, `source.png`, `reconstruction.png`, test results and a `validation.json` manifest with project-file hashes. It is not distributed as extension source or packaged output. Loopback servers and owned browsers were closed after the tests.

## Code changes for this task

- `src/analysis/agentHandoff.ts`: shared persistent/copyable agent prompt.
- `src/analysis/reconstructionProject.ts`: optional initial-scenario packaging, screenshot checks, local hashes and handoff export; no new application-generation logic.
- `src/services/reconstructionAgent.ts`: existing clipboard handoff reuses that prompt.
- `src/views/reaSidebarProvider.ts`: retain scenario evidence ID and pass captured scenario to project export.
- `tests/reconstructionAgent.test.ts`: handoff, cancellation, trust and missing-project coverage.
- `tests/reconstructionProject.test.ts`: evidence export, digest separation, mismatch and tamper rejection coverage.
- `tests/sidebar.test.ts`: scenario-to-project wiring coverage and optional argument assertion.
- `tests/agentReconstructionLive.test.ts`: opt-in collect/compare harness with implementation deliberately left to the coding agent between phases.
- `docs/web-target-analyzer.md`, `docs/web-workflow-verification.md`: document the handoff and supersede the earlier scenario-export limitation.
- `docs/agent-reconstruction-verification.md`: this report.

## Validation

- Original engine script SHA-256 still matches the earlier Web Analysis validation: `ed06cee49505b95a3cc5fceb1b4b279167e26df86227c644bb366ffffdbaf738`.
- `npm run check`: passed.
- `npm run build`: passed.
- Targeted exporter/handoff/sidebar tests: 28 passed.
- Live collect phase: passed; live compare phase: passed.
- Full suite with agent comparison and both earlier live browser workflows enabled: **191 passed, 0 failed, 2 skipped**. Skips were the separate broad engine and router live audits. Full JSON report retained as `build/agent-reconstruction-validation/test-results.json`.
- `git diff --check`: passed.

No original engine modifications, fixture changes, extension redesign, GitHub/Desktop analysis, commits, pushes or packaging were performed.

## Remaining limits

The UI's Explore Interactions action still captures only initial state. Additional source interactions in this run were requested by the coding agent through the original full-catalog client. Scenario exports are snapshots at project creation; later captures do not overwrite earlier projects. A new native Copilot/Codex window's authentication/MCP setup was not exercised by this service-level demonstration. Functional parity is limited to the existing fixture's observed native interactions; responsive layouts, pixel equality and unobserved application/backend behavior remain outside the verified result.
