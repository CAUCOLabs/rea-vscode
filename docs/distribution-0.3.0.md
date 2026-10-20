# Distribution audit — 0.3.0

## Scope and attribution

Independent VS Code extension by CAUCOLabs. The original REA engine belongs to morluto, is separately licensed under MIT and is neither bundled nor modified. `LICENSE-REA` preserves its original copyright and complete notice. Bundle dependency notices are generated from esbuild inputs; engine/provider dependencies are not incorporated into this license grant.

## Audit findings and changes

| Area | Initial dependency or risk | 0.3.0 behavior |
| --- | --- | --- |
| Manifest | 0.1.0, types newer than declared minimum, development instructions | 0.3.0; types pinned to 1.102.0; stable MCP API; desktop/local UI host; install from VSIX |
| Activation | Startup activation and view auto-connect; empty engine configuration still tried npx | Commands/view activate normally; unconfigured startup launches no engine; trust checks remain |
| Engine | Requires external Node/REA and developer User Settings; npx resolution depends on working directory/PATH | Setup resolves installed Node, requires a readable absolute engine script; no package-manager execution or downloads |
| Agent browser runtime | Companion used Extension Host process executable and Electron environment override | Companion uses configured Node, absolute installed extension bundle, optional browser path |
| Bundles | Untracked companion source and build changes already existed; no packaging boundary | Existing work retained; both entry points bundled; all production JS dependencies included; only VS Code API external |
| Browser | Standard OS paths only; local installed browser assumed | Explicit custom executable supported in analyzer and companion, detection retained; no browser/profile packaged |
| Codex | Project configuration contains paths tied to current install | Generated paths use installed extension context and resolved Node; existing tables preserved; updates may require path review |
| Copilot | Full engine provider available but no setup guidance | Native provider for engine + companion; configuration command opens MCP server list; trust/policy prompts apply |
| Packaging | No ignore file: local Codex/configuration, source, tests, maps and dependencies could leak | Allowlist for bundles/media/notices/docs; final archive independently inspected |
| Platform | macOS path behavior exercised; Windows/Linux branches present | Only macOS local validation claimed; other OS, remote extension hosts and web VS Code unverified |
| README | Said installation unavailable; development host/F5 workflow | End-user VSIX install, prerequisites, setup, diagnostics, both agents, limitations and credits |
| Licenses | Extension MIT and prose attribution only | Original engine notice + generated bundled dependency notices included |

No developer home paths were found in source/media/distributed Markdown at audit time. The dependency was primarily **configuration and runtime availability**, rather than a source literal pointing to the developer's home directory. Local `.codex` and `.vscode` configuration, node_modules, stale maps, browser state, tests and catalog audit JSON are excluded from the package. Standard OS executable locations are discovery candidates, not developer-specific paths.

Runtime configuration is intentionally external: users must provide trusted installed Node and REA. Engine native backends and extra tools retain their original requirements. No engine or browser is installed automatically. Setup's diagnostic checks paths, Node version, engine MCP handshake/catalog and browser availability; it does not certify all engine tools.

## Validation record

Validated on macOS arm64 with desktop VS Code 1.142.0 during this milestone:

- `npm run check`: passed with VS Code types pinned to the declared 1.102.0 minimum.
- `npm test`: 149 passed; two optional live integration tests skipped by default. Tests cover setup cancellation, trust, machine settings, launch configuration, Codex merge preservation, browser ownership, sidebar messages and engine/client policies.
- `npm run build` and `git diff --check`: passed.
- `npm run package`: VSCE validates the manifest and builds `rea-vscode-0.3.0.vsix` using the prepublish hook.
- `npm run verify:vsix`: the actual ZIP contains 18 files. Both bundles, five media files, documentation and complete extension/original-engine/bundled-dependency notices are included. No node_modules, source/test files, source maps, local `.codex`/`.vscode` settings, browser profiles or catalog audit JSON. No developer home paths or common secret patterns were found. This is not exhaustive credential detection.
- VS Code CLI installed the VSIX into isolated temporary user-data and extension directories and listed `caucolabs.rea-vscode@0.3.0`.
- A temporary test-driver extension activated **the installed VSIX**, confirmed command registration and packaged resources, opened the REA sidebar, and verified the real REA MCP handshake/catalog through the installed extension before disconnecting. The driver did not load the repository as the REA extension. Its result explicitly excludes visual-layout and authenticated-agent acceptance.
- The companion bundle from the installed extension was launched with the OS temporary directory as its working directory, outside the repository, and used a real installed REA engine. The live test completed acquire → engine target listing → inspection → PNG screenshot → release, and verified the CDP endpoint was unreachable afterward. The first sandboxed attempt failed to open its HTTP fixture with `EPERM`; the authorized repeat outside the sandbox passed.

Standard unit tests use VS Code mocks. CLI installation, installed-extension activation and real engine/browser protocol checks are distinct from end-to-end human validation of the setup UI or Codex/Copilot account sessions. The 1.102.0 runtime itself was not installed/tested; minimum API compilation is verified, minimum-host execution remains a release gate.

## Remaining release gates

- End-to-end human acceptance of the installed setup UI and authenticated Copilot/Codex integrations on the intended minimum and current VS Code versions.
- Windows and Linux testing before advertising those platforms as supported; remote/web environments remain outside verified scope.
- Marketplace publication is not performed. Publisher access, listing artwork and release-channel decisions remain with the maintainer.
- Existing Codex tables are deliberately preserved; review/regenerate version-specific extension paths after updates.
- Forced process/OS termination can prevent temporary browser cleanup. Full provider/tool catalog testing is not implied by MCP discovery.
