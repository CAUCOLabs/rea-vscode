import { expect, it } from 'vitest';
import { DEFAULT_TIMEOUTS, operationTimeout, StderrDiagnostics } from '../src/mcp/operationTimeouts';
it('uses independent finite operation budgets and rejects invalid runtime configuration', () => {
  expect(operationTimeout('analyze_web_bundle', {})).toBe(300_000);
  expect(operationTimeout('inspect_web_page', {})).toBe(60_000);
  expect(operationTimeout('analyze_web_bundle', { bundleAnalysisTimeoutMs: 120_000 })).toBe(120_000);
  for (const value of [0, -1, NaN, Infinity, 1.5, 3_600_001]) {
    expect(operationTimeout('analyze_web_bundle', { bundleAnalysisTimeoutMs: value })).toBe(DEFAULT_TIMEOUTS.bundleAnalysisTimeoutMs);
  }
});
it('classifies stderr across chunks without exposing arbitrary output', () => {
  const scanner = new StderrDiagnostics();
  scanner.accept('private prose /Users/private password=abc UnhandledPromise');
  scanner.accept('Rejection AbortError https://private.test/?secret=abc');
  expect(scanner.summary()).toContain('abort-error,unhandled-rejection');
  expect(scanner.summary()).not.toMatch(/private|password|secret|abc/);
});
it('distinguishes an allocation clue from the fatal V8 heap signature', () => {
  const clue = new StderrDiagnostics();
  clue.accept('allocation failed');
  expect(clue.summary()).toContain('out-of-memory');
  expect(clue.summary()).not.toContain('v8-fatal');
  const fatal = new StderrDiagnostics();
  for (const char of 'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory') fatal.accept(char);
  expect(fatal.summary()).toContain('v8-fatal-heap-exhaustion');
  expect(fatal.summary()).not.toContain('FATAL ERROR');
});
