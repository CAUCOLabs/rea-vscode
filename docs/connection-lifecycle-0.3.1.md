# MCP connection investigation — 0.3.1

Confirmed defect: the bundled MCP SDK in the 0.3.0 VSIX defaults to a 10 MiB stdio receive buffer. Its stdout handler closes the transport on buffer overflow, terminating the child after its shutdown grace period. The screenshot workflow admits up to 20 million base64 characters, with possible duplication in MCP envelopes. An otherwise valid large response can therefore terminate the main REA session, without an engine crash.

The regression uses a real stdio MCP subprocess and runs the analysis workflow with an 11 MiB response. Restoring the old 10 MiB limit makes the test fail with an actual connection loss. With the finite 64 MiB transport budget, two successive analyses and an intervening catalog request succeed. Per-evidence processing limits remain in force: accepting transport framing does not authorize unlimited evidence processing.

The client also drains stderr to avoid subprocess backpressure, guards overlapping initialization, checks for closure during initialization and logs protocol errors, session closure, operation duration/errors/cancellation and browser cleanup. Raw engine stderr is discarded; its byte count is recorded. Operation failures do not change connection state; actual transport closure still does. The webview no longer treats analysis busy state as evidence of an ongoing connection attempt.

Browser cleanup already targets only the browser launched with a separate profile and process group. It does not close the MCP client. Host regression tests verify continued tool calls after normal cleanup, cleanup failure, tool error and timeout. Existing real-transport tests cover request timeout and cancellation; a new server-exit regression confirms genuine disconnection remains visible.

Validation: npm run check; npm test (157 passed, 2 optional live tests skipped); npm run build; npm run package; npm run verify:vsix. The installed configuration, Node/REA paths, Codex configuration and original engine were not changed. No installation, publication, commit or push was performed.

Limitation: this proves a transport defect and its correction, not the exact cause of the user's Excalidraw incident. No incident logs were supplied and no real VS Code session was exercised for this patch. Excalidraw should be analyzed repeatedly in VS Code while retaining REA output to determine whether another failure remains. Messages over 64 MiB still cause a genuine transport failure and are reported rather than hidden.
