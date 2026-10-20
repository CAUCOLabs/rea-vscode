# Timeout investigation and correction — 0.3.2

## Confirmed cause of the request failure

The extension's `ReaMcpClient.inspectWebTarget` in 0.3.1 passed `timeout: 20_000` and `maxTotalTimeout: 25_000` to every web tool. The installed MCP SDK request timer fires at 20,000 ms, rejects with error -32001, removes request/progress handlers, and sends `notifications/cancelled` for that request. Progress does not reset the timer by default. The 25,000 ms option is a ceiling checked when resetting a progress timer, not an additional five-second allowance. No client disconnect is performed by this timeout path. The production duration of 20,001 ms agrees with that timer.

Codex's generated `tool_timeout_sec = 300` does not govern the extension's own MCP connection. It was not changed. MCP initialization and the successful discovery, inspection and screenshot operations rule out a launch failure in this sequence.

Read-only review of the existing engine checkout found that `CdpBrowserProvider.analyzeBundle` captures the page again, obtains script sources through `CdpPageCaptureScripts.captureScripts` (a sequential loop awaiting `Debugger.getScriptSource`), then analyzes the captured sources. The 500 ms observation window is only one phase. Script count, source size and CDP latency influence total duration. The operation is not guaranteed to finish within 20 seconds; the actual production completion time remains unmeasured. This review did not execute, modify or reinstall the engine.

## Subsequent transport closure: unresolved production cause

The supplied production log records only `stderrBytes=6154`; the stderr content, exit code and signal are not available. They cannot be recovered from that count. A four-second interval alone does not prove a cancellation crash, buffer overflow or browser-cleanup defect.

The SDK's stdio `close()` ends stdin, waits up to two seconds, sends SIGTERM if needed, waits up to another two seconds, then sends SIGKILL if needed. That is a possible explanation for a roughly four-second shutdown **only if close was invoked**. The SDK also invokes close on receive-buffer overflow. Neither is established by the supplied incident. The request timeout path itself does not invoke close. Browser cleanup still closes only its owned browser.

New diagnostics record transport `close()` invocation separately from transport closure, fixed protocol error categories, last operation/outcome, elapsed time since it finished, stderr byte count and fixed stderr categories. Categories are heuristic clues, not proof; raw stderr and arbitrary error messages are never logged. Only a 128-character scanning suffix is retained between stderr chunks. Unclassified output remains unclassified. The public SDK does not expose child exit status/signal, so this patch does not claim those diagnostics.

## Implemented behavior

- `rea.webOperationTimeoutMs`: absolute per-request budget, default 60,000 ms.
- `rea.bundleAnalysisTimeoutMs`: separate absolute bundle budget, default 300,000 ms.
- Both accept integer milliseconds from 1 to 3,600,000; invalid runtime values fall back to defaults. Configuration is read for each operation. Progress does not extend the budget.
- Removed the competing 105-second global abort timer. Browser preparation retains its existing budget and isolation. Explicit cancellation, disposal and trust checks remain enforced.
- Timeout cancels only the affected MCP request. No automatic disconnect, restart, reconnect or retry was added. Late replies do not complete a subsequent request.
- Completed page evidence and verified screenshots survive subsequent operation failure and genuine transport loss as a partial report. The sidebar no longer aborts/discards that report solely because the server unexpectedly disconnected. Explicit disconnect still cancels active work.
- Genuine transport loss still clears the live session and updates connection state to disconnected. Partial evidence never claims full success; the UI displays the retained capture and missing coverage.

## Regression coverage

Real subprocess/stdio tests cover the successful discovery → inspection → screenshot → bundle sequence, cooperative timeout cancellation, a late handler response, a bundle response taking more than 20 seconds, and a simulated server exit four seconds after a real 20-second timeout. The latter reproduces timing and lifecycle, not the unknown production crash mechanism. Subsequent calls work after isolated timeouts and fail after actual server exit. A separate test verifies retained evidence when the server dies during bundle analysis. Sidebar tests verify retained partial report publication with disconnected state. Unit tests verify finite budget validation and stderr classification without disclosing paths, URLs or secret test values. Existing explicit cancellation, cleanup and reconnect tests remain in place.

## Limits

No VS Code GUI or production-page reproduction was performed. Optional live engine/browser tests require explicit environment configuration and remain skipped by default. A longer finite budget does not guarantee completion. A server that crashes on cancellation still requires an engine-side investigation; this extension cannot keep a dead process connected. Oversized transport messages remain genuine failures. No raw production stderr was supplied or retained previously, so the exact reason for the reported unexpected closure remains unknown.
