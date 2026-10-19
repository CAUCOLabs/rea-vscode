export const READ_ONLY_TOOL = 'list_unknowns';
export type SidebarAction = 'ready' | 'connect' | 'disconnect' | 'refresh' | 'execute';
export type SidebarMessage = { type: SidebarAction };

export function parseSidebarMessage(value: unknown): SidebarMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.type !== 'string') return;
  if (['ready', 'connect', 'disconnect', 'refresh', 'execute'].includes(record.type)) {
    return { type: record.type as SidebarAction };
  }
}

// Defense in depth: never send configuration, environment, or raw errors to the view.
// Redaction cannot recognize every possible secret embedded in arbitrary prose.
export function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { return JSON.stringify(redact(JSON.parse(trimmed)), null, 2); } catch { /* Treat non-JSON output as text. */ }
    }
    return value.replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{16,}|github_pat_[\w]+)\b/g, '[REDACTED]')
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED]')
      .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
      .replace(/((?:api[_-]?key|password|secret|token)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, /password|secret|token|api[_-]?key|authorization|credential/i.test(key) ? '[REDACTED]' : redact(item)
    ]));
  }
  return value;
}

export function resultText(value: unknown): string {
  const text = JSON.stringify(redact(value), null, 2) ?? '';
  return text.length > 100_000 ? text.slice(0, 100_000) + '\n[Output truncated]' : text;
}
