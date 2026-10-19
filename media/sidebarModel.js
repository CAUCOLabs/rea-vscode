// Pure presentation helpers shared by the Webview and DOM tests.
// Prefix groups are lexical name patterns, not inferred capabilities or permissions.
(() => {
  function groupTools(tools, query = '') {
    const groups = new Map();
    const search = query.trim().toLowerCase();
    for (const tool of tools) {
      if (!(tool.name + ' ' + tool.description).toLowerCase().includes(search)) continue;
      const prefix = /^([a-z][a-z0-9]*)_/.exec(tool.name)?.[1];
      const key = prefix ? `${prefix}_*` : 'No underscore prefix';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tool);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, items]) => ({
      name, tools: items.sort((a, b) => a.name.localeCompare(b.name))
    }));
  }

  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const printable = value => typeof value === 'string' ? value : JSON.stringify(value);
  function parameters(schema) {
    if (!object(schema) || !object(schema.properties)) return [];
    const required = Array.isArray(schema.required) ? schema.required : [];
    return Object.entries(schema.properties).map(([name, definition]) => {
      const field = object(definition) ? definition : {};
      const type = Array.isArray(field.type) ? field.type.join(' | ') : typeof field.type === 'string' ? field.type
        : typeof field.$ref === 'string' ? field.$ref : field.oneOf || field.anyOf || field.allOf ? 'Composite — see schema' : 'See schema';
      const constraints = [];
      if (Array.isArray(field.enum)) constraints.push(`Allowed: ${field.enum.map(printable).join(', ')}`);
      if (Object.hasOwn(field, 'const')) constraints.push(`Value: ${printable(field.const)}`);
      if (Object.hasOwn(field, 'default')) constraints.push(`Default: ${printable(field.default)}`);
      for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern']) {
        if (Object.hasOwn(field, key)) constraints.push(`${key}: ${printable(field[key])}`);
      }
      return { name, type, required: required.includes(name), description: typeof field.description === 'string' ? field.description : '', constraints };
    });
  }

  function response(text, isError = false) {
    if (!text) return { state: 'empty', sections: [] };
    let result;
    try { result = JSON.parse(text); } catch {
      return { state: isError ? 'error' : 'success', sections: [{ title: 'Response text', value: text }], truncated: text.endsWith('[Output truncated]') };
    }
    const sections = [];
    if (object(result) && Object.hasOwn(result, 'structuredContent')) {
      sections.push({ title: 'Structured content', value: result.structuredContent });
    } else if (object(result) && Array.isArray(result.content)) {
      for (const [index, block] of result.content.entries()) {
        if (!object(block)) continue;
        if (block.type === 'text' && typeof block.text === 'string') {
          let value = block.text;
          try { value = JSON.parse(block.text); } catch { /* Plain text stays plain text. */ }
          sections.push({ title: `Content ${index + 1}`, value });
        } else {
          sections.push({ title: `Content ${index + 1} (${String(block.type ?? 'unknown')})`, value: block });
        }
      }
    } else sections.push({ title: 'Response', value: result });
    return { state: isError || result?.isError === true ? 'error' : 'success', sections };
  }
  globalThis.reaSidebarModel = { groupTools, parameters, response };
})();
