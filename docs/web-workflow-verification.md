# Web Analysis workflow validation — REA for VS Code 0.4.0

Date: 2026-10-23. Platform: macOS arm64 with installed Chrome/Chromium. Target: the repository's existing `tests/fixtures/web-target` served on an ephemeral literal-loopback port. No public website, personal browser profile, login or external API was used as the target. REA was launched directly from the original `scripts/rea.mjs --mcp` override with Node.js; its package version was 6.7.0. All 207 original tools remained discoverable.

## Scope and existing implementation

This is a real-engine, service-level end-to-end test using the same functions called by the sidebar: `startAnalysisBrowser`, `ReaMcpClient.inspectWebTarget`, `analyzeWebTarget`, `captureInitialWebScenario`, and `createReconstructionProject`. VS Code panel clicks, native dialogs and the clipboard/new-window Generate with AI handoff were not driven in this run; their existing host/presentation tests passed. The generated output is the existing static reconstruction starter, not a complete source-app clone or an AI-generated application.

The unchanged original engine and all 207 tools were preserved. No GitHub/Desktop App analysis, extension redesign, commit, push or packaging was performed. Raw test artifacts and the generated project were retained under ignored `build/web-analysis-validation/`.

## Exact original tools executed by the end-to-end test

| Order | Tool | Purpose |
| --- | --- | --- |
| 1 | `list_browser_targets` | Discover the extension-owned fixture tab by exact final URL/origin. |
| 2 | `inspect_web_page` | Read semantic DOM, accessibility roles/names/states, declarations and bounded resource/network metadata. |
| 3 | `capture_web_screenshot` | Capture and hash-check the visible fixture viewport. |
| 4 | `analyze_web_bundle` | Statically analyze the fixture's one 176-byte script with source-map fetching disabled. |
| 5 | `capture_browser_scenario` | Existing Explore Interactions behavior: provider-owned browser, `initial_observation`, `wait_for_timeout` 500 ms, then screenshot/DOM/accessibility/URL capture. |
| 6 | `list_browser_targets` | Discover the generated project's preview tab. |
| 7 | `inspect_web_page` | Verify the generated page's observed heading and control states. |
| 8 | `capture_web_screenshot` | Capture a preview of the generated page. |
| 9 | `capture_browser_scenario` | Separate test-only validation: click the generated `Limitations` link by its exact accessible role/name and verify the resulting `#limitations` URL and DOM. |

The ninth operation is not a newly implemented extension interaction workflow. It uses the existing unrestricted client against only the generated local page. Reconstruction generation itself uses the extension's local file generator, not an original REA reconstruction tool.

The full regression run also enabled the existing companion-browser live test, executing original `list_browser_targets`, `inspect_web_page` and `capture_web_screenshot` through the companion lease. Existing bundled-engine tests separately executed `list_unknowns` and the expected missing-Wireshark `inspect_pcap_client` case.

## Genuine evidence retained

- Four valid original Evidence envelopes from the main analysis, including `ev_` identifiers, original operation names/provider metadata and normalized results. Full raw responses are retained in numbered JSON files, not fabricated fixtures.
- 41 findings: 21 OBSERVED, 0 INFERRED and 20 UNKNOWN. Source title/heading `Example catalog`, `Search items`, disabled `Save (not implemented)`, semantic structure and declared navigation were observed. No route, endpoint or framework inference was fabricated from the fixture's bare candidate strings.
- Source viewport PNG: 756 × 469 pixels, 24,971 bytes. SHA-256 `42f54d1b97b84dd41a9ef9fd7ab76505106be3a8586bbbf640b83923bc67bf3e`. PNG header dimensions, byte count and hash were checked. The original bytes are retained unchanged in the generated project.
- Static analysis captured exactly one 176-byte source artifact; its digest matched the fixture's actual `app.js`: `77c36074712a33108586fe0d4d14cba5c379ede2c3e8658087a283b6b4668024`. Empty route/endpoint results are a bounded observation, not proof of missing backend behavior.
- Initial scenario completeness: `complete`, no missing or truncated sections. Screenshot hash was verified. DOM text was 777 bytes with SHA-256 `2788b6c00ce055dadd5cca6deabace0709a96280b48343868778547e4f0a2051`; accessibility text was 526 bytes with SHA-256 `c1f9c135abf40116ffa48f701e4cc18b20adfb95407d71bd2eda5e756dd968d3`. Both lengths and hashes were checked against the returned UTF-8 text.
- Browser accessibility evidence confirmed the generated Save button and Search items field are disabled. The test-only section click completed and reached the expected local fragment URL.
- Both extension-owned CDP endpoints became unreachable after close, while the MCP session remained connected. Scenario responses report provider-owned browser cleanup as `terminated-owned-process`.

`validation.json` records all nine evidence IDs, response filenames, engine-script digest, screenshot provenance and retained project location. Hash checks establish consistency of received bytes; they are not an independent attestation of the engine.

## Files generated

Project directory: `build/web-analysis-validation/projects/rea-reconstruction-verified/`.

| File | Validated behavior |
| --- | --- |
| `index.html` | Parses and renders in Chrome; observed heading/control labels retained; CSP present; no script injected. Generated section navigation works. |
| `styles.css` | Served successfully as CSS; generated preview was captured and visually inspected. Styling remains original starter styling. |
| `evidence.json` | Valid JSON with observed structure/components, navigation declarations, unknowns and screenshot provenance. Screenshot digest matches the retained PNG. |
| `reconstruction-brief.md` | Exact specification produced by the corrected report workflow, including OBSERVED/UNKNOWN boundaries. |
| `README.md` | Documents a dependency-free static starter and placeholder behavior. |
| `evidence/viewport.png` | Byte-for-byte equal to the verified original screenshot. |

Additional retained validation artifacts: numbered raw tool responses, `catalog.json`, `executed.json`, `report.json`, `report.md`, `generated-preview.png`, `validation.json`, and `test-results.json`. The loopback servers were stopped after validation; the retained project files can be served again independently.

## Necessary correction

The live report exposed one defect: `reconstructionSpec` selected OBSERVED visual evidence but prefixed it with the hardcoded label UNKNOWN, and omitted visual unknowns from that section. It now preserves each visual finding's actual classification and includes the visual limitations. The verified screenshot is OBSERVED; geometry/styles/responsive gaps remain UNKNOWN. No generator UI or original REA code changed.

Files changed for this task:

- `src/analysis/webTargetAnalyzer.ts`: visual classification correction.
- `tests/webTargetAnalyzer.test.ts`: regression assertions for observed screenshot and unknown visual limitations.
- `tests/webWorkflowLive.test.ts`: opt-in original-engine end-to-end regression test with retained evidence and generated-project browser validation.
- `docs/web-target-analyzer.md`: corrected current scenario/reconstruction behavior and linked this report.
- `docs/web-workflow-verification.md`: this report.

## Checks executed

- `npm run check`: passed.
- `npm run build`: passed.
- Targeted real workflow plus analyzer and reconstruction tests: 30 passed, 0 failed.
- Full Vitest suite with both `REA_WEB_WORKFLOW_SCRIPT` and `REA_BROWSER_LIVE_SCRIPT` targeting the original engine: 186 passed, 0 failed, 2 skipped. Skips were the separate broad engine audit and optional router live audit, not Web Analysis tests. Full JSON results are retained in the build artifact directory.
- `git diff --check`: passed.

The first sandboxed attempt could not bind loopback (`listen EPERM`). The same controlled test was rerun with execution approval and passed. No network or browser restriction was bypassed.

## Remaining limitations

- Explore Interactions currently records the initial state only. Actual source-page clicks, typing, form submission and action outcomes remain unimplemented in that UI; the original scenario tool can perform such actions through the full-catalog client. This task did not add them.
- Initial scenario evidence is displayed and appended to Markdown export, but the reconstruction project generator receives only the main WebReport. Scenario artifacts are not automatically incorporated into its evidence.json/brief; raw scenario evidence is retained separately in this validation bundle.
- The generated project intentionally has disabled application controls and placeholder destinations. Only its own section navigation was functionally verified. It is not a working search/save application, backend reconstruction, responsive match or pixel-equivalent recreation.
- Geometry, computed styles, multi-viewport behavior, authenticated sites and public-site diversity remain untested. The local fixture does not establish those capabilities. No native Windows/Linux validation was performed here.


## Subsequent agent handoff validation

The scenario-export limitation above describes this earlier run. The later [agent reconstruction validation](agent-reconstruction-verification.md) adds optional scenario-evidence.json/evidence/scenario.png export and a persistent agent-handoff.md, then validates a separate Codex-authored implementation with real source/reconstruction interaction replay. The extension still does not implement the application or add active clicks to its Explore Interactions button.
