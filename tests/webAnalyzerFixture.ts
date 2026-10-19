import type { WebTool } from '../src/services/webToolPolicy';
export const webTarget = 'https://app.example.test/';
const common = {
  cdp_endpoint: { type: 'string', minLength: 1 },
  allowed_origins: { type: 'array', items: { type: 'string', minLength: 1 } }
};
const capture = {
  ...common, target_id: { type: 'string', minLength: 1 },
  observation_ms: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, default: 500 },
  include_accessibility_text: { type: 'boolean', default: false },
  include_console_text: { type: 'boolean', default: false },
  include_json_body_shapes: { type: 'boolean', default: false },
  include_websocket_shapes: { type: 'boolean', default: false },
  include_storage_keys: { type: 'boolean', default: false },
  include_storage_fingerprints: { type: 'boolean', default: false },
  include_script_sources: { type: 'boolean', default: false }
};
const schema = (properties: object, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false, $schema: 'https://json-schema.org/draft/2020-12/schema' });
// Verified live REA 6.7.0 input schema subset, including every property used.
export const webSchemas = {
  list_browser_targets: schema(common, ['cdp_endpoint']),
  inspect_web_page: { ...schema(capture, ['cdp_endpoint', 'target_id']), minProperties: 2 },
  analyze_web_bundle: schema({ ...capture, include_script_sources: { type: 'boolean', default: true }, fetch_source_maps: { type: 'boolean', default: false } }, ['cdp_endpoint', 'target_id'])
};
export const discovery = { targets: [{ target_id: 'page-1', type: 'page', title: 'Example', url: webTarget, origin: new URL(webTarget).origin }] };
export const page = {
  target: { title: 'Example <script>not code</script>', url: webTarget },
  capture_window: { observation_ms: 500, started_at: '2026-01-01T00:00:00Z', ended_at: '2026-01-01T00:00:00.500Z' },
  completeness: { status: 'attach_limited', unavailable_sections: ['workers'], attach_limited_sections: ['network_requests'], truncated_sections: [], policy_filtered_sections: ['storage_keys'] },
  dom: { total_nodes: 3, nodes: [{ index: 0, node_name: 'MAIN' }, { index: 1, node_name: 'A' }, { index: 2, node_name: 'BUTTON' }] },
  accessibility: { text_capture: { status: 'included' }, nodes: [
    { role: 'main', name: 'Application', ignored: false }, { role: 'link', name: 'Settings', ignored: false },
    { role: 'button', name: 'Save', ignored: false }, { role: 'button', name: 'Ignored hidden control', ignored: true }
  ] },
  metadata: { dom_urls: [{ node_index: 1, attribute: 'href', url: `${webTarget}settings?session=private-value`, destination_scope: 'approved' }] },
  resources: [{ type: 'Script', mime_type: 'text/javascript', url: `${webTarget}app.js?key=private-value` }],
  scripts: { total: 1 }, network: { requests: [{ method: 'GET', url: `${webTarget}api/items?session=private-value`, status: 200, mime_type: 'application/json', body: 'DO NOT EXPORT BODY' }], prior_activity_available: false },
  storage: { password: 'DO NOT EXPORT STORAGE' }, limitations: ['Attach window only']
};
export const bundle = {
  capture: { target_url: webTarget, scripts_observed: 1, scripts_analyzed: 1 },
  observations: { routes: [{ value: '/settings', mechanism: 'string literal', location: { script_key: 'scr_example', line: 1 } }], endpoints: [{ value: `${webTarget}api/items`, mechanism: 'fetch literal', location: { script_key: 'scr_example', line: 2 } }] },
  inferences: [{ kind: 'vendor_fingerprint', value: 'Example library', confidence: 'low', basis: [{ script_key: 'scr_example', detector: 'fixture' }] }],
  completeness: { status: 'complete', parsed_scripts: 1, parse_failures: 0 }, unknowns: [], limitations: []
};
export function evidenceResult(tool: WebTool, data: unknown) {
  const digit = tool === 'list_browser_targets' ? 'a' : tool === 'inspect_web_page' ? 'b' : 'c';
  return { content: [{ type: 'text', text: JSON.stringify({ evidence_id: `ev_${digit.repeat(64)}`, operation: tool, confidence: 'observed', normalized_result: data }) }] };
}
export function webResponse(tool: WebTool) {
  return evidenceResult(tool, tool === 'list_browser_targets' ? discovery : tool === 'inspect_web_page' ? page : bundle);
}
