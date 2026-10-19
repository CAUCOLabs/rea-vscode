// These three operations were reviewed in REA 6.7.0 browserToolContracts,
// browserObservation and webBundleAnalysis. Passive toward the page; REA
// records Evidence and accesses CDP, so its readOnlyHint is intentionally false.
export const WEB_TOOLS = ['list_browser_targets', 'inspect_web_page', 'analyze_web_bundle'] as const;
export type WebTool = typeof WEB_TOOLS[number];
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const CDP_SETUP = 'Start a separate Chromium profile with --remote-debugging-port=9222 and --user-data-dir pointing to a dedicated profile. Open the exact target URL manually. This analyzer accepts only an HTTP CDP discovery endpoint on literal 127.0.0.1 or [::1] with an explicit port (default http://127.0.0.1:9222). No navigation or browser launch is performed.';

export function targetUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter an absolute HTTP(S) target URL.'); }
  if (value.length > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hostname.includes('*')) throw new Error('Target must be an HTTP(S) URL without embedded credentials.');
  return url;
}
export function cdpEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(CDP_SETUP); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(CDP_SETUP);
  return url.origin;
}
export function webArguments(name: WebTool, endpoint: string, origin: string, id?: string): Record<string, unknown> {
  const cdp = cdpEndpoint(endpoint);
  const parsedOrigin = targetUrl(origin);
  if (parsedOrigin.origin !== origin) throw new Error('One exact target origin is required.');
  const base = { cdp_endpoint: cdp, allowed_origins: [origin] };
  if (name === 'list_browser_targets') return base;
  if (!id || id.length > 256 || /[\x00-\x1f]/.test(id)) throw new Error('Invalid browser target identifier.');
  const flags = { ...base, target_id: id, observation_ms: 500,
    include_accessibility_text: true, include_console_text: false,
    include_json_body_shapes: false, include_websocket_shapes: false,
    include_storage_keys: false, include_storage_fingerprints: false,
    include_script_sources: name === 'analyze_web_bundle' };
  return name === 'analyze_web_bundle' ? { ...flags, fetch_source_maps: false } : flags;
}

// Fail closed on schema drift; do not interpret unions/refs or unknown keywords.
// Only validate the closed argument groups produced above, never caller-supplied
// CDP actions, source snippets, arbitrary tool names, or dynamic browser commands.
export function acceptsWebArguments(name: WebTool, schema: unknown, args: Record<string, unknown>): boolean {
  if (!WEB_TOOLS.includes(name) || !isRecord(schema) || schema.type !== 'object' || schema.additionalProperties !== false || !isRecord(schema.properties)) return false;
  const rootKeys = ['type', 'properties', 'required', '$schema', 'additionalProperties', 'description', 'title', 'examples', 'minProperties'];
  if (Object.keys(schema).some(key => !rootKeys.includes(key)) || (schema.$schema !== undefined && schema.$schema !== 'https://json-schema.org/draft/2020-12/schema')) return false;
  if (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string' || !Object.hasOwn(args, key))) return false;
  if (schema.minProperties !== undefined && (typeof schema.minProperties !== 'number' || !Number.isSafeInteger(schema.minProperties) || schema.minProperties < 0 || Object.keys(args).length < schema.minProperties)) return false;
  if (Object.keys(schema.properties).length !== Object.keys(args).length) return false;
  for (const [key, value] of Object.entries(args)) {
    const field = schema.properties[key];
    if (!isRecord(field) || Object.keys(field).some(k => !['type', 'items', 'minLength', 'minimum', 'maximum', 'default', 'description', 'title', 'examples'].includes(k))) return false;
    for (const key of ['minLength', 'minimum', 'maximum']) {
      if (field[key] !== undefined && (typeof field[key] !== 'number' || !Number.isFinite(field[key]))) return false;
    }
    if (field.minLength !== undefined && (!Number.isSafeInteger(field.minLength) || (field.minLength as number) < 0)) return false;
    if (field.type === 'array') {
      if (!Array.isArray(value) || !isRecord(field.items) || field.items.type !== 'string' || Object.keys(field.items).some(k => !['type', 'minLength'].includes(k))) return false;
      const itemSchema = field.items;
      if (itemSchema.minLength !== undefined && (typeof itemSchema.minLength !== 'number' || !Number.isSafeInteger(itemSchema.minLength) || itemSchema.minLength < 0)) return false;
      if (value.some(item => typeof item !== 'string' || (typeof itemSchema.minLength === 'number' && item.length < itemSchema.minLength))) return false;
    } else if (field.type === 'integer') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || (typeof field.minimum === 'number' && value < field.minimum) || (typeof field.maximum === 'number' && value > field.maximum)) return false;
    } else if (field.type === 'string') {
      if (typeof value !== 'string' || (typeof field.minLength === 'number' && value.length < field.minLength)) return false;
    } else if (field.type !== 'boolean' || typeof value !== 'boolean') return false;
  }
  return true;
}
