import type { WebTool } from '../services/webToolPolicy';

export interface OperationTimeouts { webOperationTimeoutMs: number; bundleAnalysisTimeoutMs: number }
export const DEFAULT_TIMEOUTS: OperationTimeouts = { webOperationTimeoutMs: 60_000, bundleAnalysisTimeoutMs: 300_000 };
export function operationTimeout(tool: WebTool, values: Partial<OperationTimeouts>): number {
  const key = tool === 'analyze_web_bundle' ? 'bundleAnalysisTimeoutMs' : 'webOperationTimeoutMs';
  const value = values[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 3_600_000 ? value : DEFAULT_TIMEOUTS[key];
}

export function protocolErrorCategory(error: Error): string {
  if (/buffer|maximum.*size|message.*size/i.test(error.message)) return 'message-buffer-limit';
  if (/EPIPE|broken pipe/i.test(error.message)) return 'broken-pipe';
  if (/JSON|parse/i.test(error.message)) return 'invalid-json';
  return 'unclassified';
}

// Fixed categories only: arbitrary stderr prose, paths, URLs and source snippets
// never leave this bounded scanner. Categories are clues, not proof of a failure cause.
export class StderrDiagnostics {
  bytes = 0;
  private tail = '';
  private readonly categories = new Set<string>();
  accept(chunk: Buffer | string): void {
    this.bytes += Buffer.byteLength(chunk);
    const data = this.tail + chunk.toString();
    for (const [name, pattern] of [
      ['uncaught-exception', /uncaught(?:Exception| exception)/i],
      ['unhandled-rejection', /unhandled(?:PromiseRejection| rejection)/i],
      ['out-of-memory', /heap out of memory|allocation failed/i],
      ['v8-fatal-heap-exhaustion', /FATAL ERROR:[^\r\n]{0,200}(?:JavaScript heap out of memory|Allocation failed - process out of memory)/i],
      ['broken-pipe', /\bEPIPE\b/],
      ['abort-error', /\bAbortError\b/],
      ['timeout', /timed out|timeout/i]
    ] as const) if (pattern.test(data)) this.categories.add(name);
    this.tail = data.slice(-512);
  }
  summary(): string { return `stderrBytes=${this.bytes}; stderrCategories=${[...this.categories].sort().join(',') || 'unclassified'}`; }
}
