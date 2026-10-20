# Distribution and validation — 0.3.3

## Packaged engine

REA 6.7.0 is copied from the existing built source repository into `runtime/rea` without edits to the upstream source. The VSIX contains its `scripts/rea.mjs` entry point, `dist`, required bridge and skill files, production npm dependency closure, MIT license and upstream third-party notices. The optional Frida package is not present. The unused Windows native artifact verification helper is excluded; platform-specific binaries are not redistributed by this extension.

`rea.scriptPath` remains an optional absolute override. The default engine path is derived from the installed extension root. Both REA Explorer and the native MCP provider use this packaged path. Node is detected from the configured command and standard locations, checked against the engine's supported range, and passed to MCP as an absolute executable. When none is available, setup guidance includes the Node download page and the **REA: Set Up REA** command.

## Validation performed

- TypeScript type check: `npm run check`.
- Automated test suite: result is recorded in the task handoff after the final run.
- Packaged-engine MCP handshake through the same stdio client used by the Explorer; the bundled engine returned its live tool catalog.
- Missing runtime and missing packaged engine cases covered by automated tests.
- VSIX archive inspected for required engine files, license/notices, unexpected entries and common machine-path/secret patterns.

Validation was performed on macOS arm64 with Node 26.8.1. It verifies engine startup and extension packaging on this host; it does not establish support for other operating systems or all REA provider integrations.

## Remaining platform work

- Build and install the VSIX on Windows x64 and Linux x64, then run the packaged MCP handshake and Explorer smoke test on each platform.
- Confirm provider-specific native backends, executable discovery, permissions and licensing on each platform.
- Test VS Code's minimum supported API version 1.102 and current Copilot/MCP integration in a real installed window.
- Remote SSH, WSL, container and web extension hosts are untested.

The engine's native analysis backends and optional external programs such as browsers, Wireshark/tshark, Ghidra or Hopper are not bundled. Their platform setup and licensing remain separate. No Codex user MCP configuration was modified during this work.
