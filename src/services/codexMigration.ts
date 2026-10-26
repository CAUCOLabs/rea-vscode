import { parse } from 'smol-toml';
import { isDeepStrictEqual } from 'node:util';

type Span = { start: number; end: number; contentEnd: number; equal: number };
const unsafe = () => new Error('This TOML layout cannot be safely migrated automatically. No settings were written. Update the REA command/args and remove ELECTRON_RUN_AS_NODE manually, or use explicit [mcp_servers.rea] and [mcp_servers.rea_browser] tables and retry.');

// Locate statements without interpreting text inside comments, quoted keys,
// multiline strings, arrays or inline tables as TOML syntax.
function spans(text: string, delimiter = '\n'): Span[] {
  const result: Span[] = [];
  let start = 0, equal = -1, contentEnd = 0, depth = 0;
  let quote = '', triple = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      contentEnd = i + 1;
      if (quote === '"' && c === '\\') { i++; contentEnd = i + 1; continue; }
      if (c === quote) {
        if (!triple) quote = '';
        else if (text.slice(i, i + 3) === quote.repeat(3)) {
          // TOML allows four/five closing quotes (one/two are content).
          while (text[i + 3] === quote) i++;
          i += 2; contentEnd = i + 1; quote = '';
        }
      }
      continue;
    }
    if (c === '#') {
      while (i < text.length && text[i] !== '\n') i++;
      if (i === text.length) break;
      if (depth || delimiter !== '\n') continue;
    } else if (c === '"' || c === "'") {
      quote = c; triple = text.slice(i, i + 3) === c.repeat(3);
      if (triple) i += 2;
      contentEnd = i + 1; continue;
    } else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === '=' && depth === 0 && equal < 0) equal = i;
    if (text[i] === delimiter && depth === 0) {
      result.push({ start, end: i + 1, contentEnd, equal });
      start = i + 1; equal = -1; contentEnd = start;
    } else if (!/\s/.test(text[i])) contentEnd = i + 1;
  }
  if (quote || depth) throw unsafe();
  if (start < text.length) result.push({ start, end: text.length, contentEnd, equal });
  return result;
}

function keyPath(key: string): string[] {
  let value: unknown = parse(`${key} = 1`);
  const keys: string[] = [];
  while (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length !== 1) throw unsafe();
    keys.push(entries[0][0]); value = entries[0][1];
  }
  if (value !== 1) throw unsafe();
  return keys;
}
const same = (a: string[], b: string[]) => isDeepStrictEqual(a, b);

/** Text edits cover only confirmed launch fields. Semantic comparison below
 * proves that custom settings and unrelated TOML values survive every edit. */
export function migrateCodexLaunches(existing: string, command: string, args: string[], browserArgs: string[]): string | undefined {
  try {
    const expected = parse(existing);
    const servers = expected.mcp_servers as Record<string, any> | undefined;
    if (!servers) return undefined;
    const desired: Record<string, { command: string; args: string[] }> = {
      rea: { command, args }, rea_browser: { command, args: browserArgs }
    };
    const edits: { start: number; end: number; value: string }[] = [];
    const headers = new Map<string, Span>();
    const assignments: { path: string[]; context: string[]; span: Span }[] = [];
    let context: string[] = [];
    for (const span of spans(existing)) {
      const raw = existing.slice(span.start, span.contentEnd).trim();
      if (!raw) continue;
      if (raw.startsWith('[')) {
        const array = raw.startsWith('[[');
        context = keyPath(raw.slice(array ? 2 : 1, array ? -2 : -1));
        if (!array && context.length === 2 && context[0] === 'mcp_servers') headers.set(context[1], span);
      } else if (span.equal >= 0) {
        assignments.push({ context: [...context], path: [...context, ...keyPath(existing.slice(span.start, span.equal).trim())], span });
      } else throw unsafe();
    }
    let changed = false;
    for (const [name, launch] of Object.entries(desired)) {
      if (!Object.hasOwn(servers, name)) continue;
      const server = servers[name];
      if (!server || typeof server !== 'object' || Array.isArray(server)) throw unsafe();
      const missing: string[] = [];
      for (const field of ['command', 'args'] as const) {
        if (isDeepStrictEqual(server[field], launch[field])) continue;
        changed = true;
        const assignment = assignments.find(entry => same(entry.path, ['mcp_servers', name, field]));
        if (assignment) {
          const { span } = assignment;
          let start = span.equal + 1;
          while (/\s/.test(existing[start] ?? '') && start < span.contentEnd) start++;
          edits.push({ start, end: span.contentEnd, value: JSON.stringify(launch[field]) });
        } else if (server[field] === undefined) missing.push(`${field} = ${JSON.stringify(launch[field])}`);
        else throw unsafe(); // Inline parent tables require a manual migration.
        server[field] = launch[field];
      }
      if (server.env && Object.hasOwn(server.env, 'ELECTRON_RUN_AS_NODE')) {
        changed = true;
        const leaf = assignments.find(entry => same(entry.path, ['mcp_servers', name, 'env', 'ELECTRON_RUN_AS_NODE']));
        if (leaf) {
          const envPath = ['mcp_servers', name, 'env'];
          const preserveEmpty = Object.keys(server.env).length === 1 && leaf.context.length < envPath.length;
          edits.push({ start: leaf.span.start, end: leaf.span.end,
            value: preserveEmpty ? envPath.slice(leaf.context.length).map(key => JSON.stringify(key)).join('.') + ' = {}\n' : '' });
        }
        else {
          const env = assignments.find(entry => same(entry.path, ['mcp_servers', name, 'env']));
          if (!env) throw unsafe();
          const start = existing.indexOf('{', env.span.equal + 1);
          const end = env.span.contentEnd - 1;
          if (start < 0 || existing[end] !== '}') throw unsafe();
          const inner = existing.slice(start + 1, end);
          const entries = spans(inner, ',');
          const index = entries.findIndex(entry => entry.equal >= 0 && same(keyPath(inner.slice(entry.start, entry.equal).trim()), ['ELECTRON_RUN_AS_NODE']));
          if (index < 0) throw unsafe();
          const entry = entries[index];
          edits.push({ start: start + 1 + (index === entries.length - 1 && index > 0 ? entry.start - 1 : entry.start),
            end: start + 1 + entry.end, value: '' });
        }
        delete server.env.ELECTRON_RUN_AS_NODE;
      }
      if (missing.length) {
        const header = headers.get(name);
        const newline = existing.includes('\r\n') ? '\r\n' : '\n';
        const value = missing.join(newline) + newline;
        // Dotted assignments define their parent table implicitly; reopening
        // that table would be invalid. Add missing keys in the same scope.
        const anchor = assignments.find(entry => entry.path.length > 2 &&
          entry.path[0] === 'mcp_servers' && entry.path[1] === name &&
          entry.context.length <= 2);
        if (header) edits.push({ start: header.end, end: header.end, value: (existing[header.end - 1] === '\n' ? '' : newline) + value });
        else if (anchor) {
          const prefix = ['mcp_servers', name].slice(anchor.context.length).map(key => JSON.stringify(key)).join('.');
          edits.push({ start: anchor.span.start, end: anchor.span.start,
            value: missing.map(line => prefix ? prefix + '.' + line : line).join(newline) + newline });
        } else edits.push({ start: existing.length, end: existing.length, value: `${newline}[mcp_servers.${name}]${newline}${value}` });
      }
    }
    if (!changed) return undefined;
    let result = existing;
    for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
    if (!isDeepStrictEqual(parse(result), expected)) throw unsafe();
    return result;
  } catch { throw unsafe(); }
}
