(() => {
  const vscode = acquireVsCodeApi();
  const { groupTools, parameters, response } = globalThis.reaSidebarModel;
  const byId = id => document.getElementById(id);
  let tools = [], selected, connected = false, trusted = false, busy = false;
  let toolButtons = [];
  let toolGroups = [];
  let parameterInputs = [];
  const expandedGroups = new Map();
  const searchExpandedGroups = new Map();
  let lastQuery = '';
  const currentExpansion = () => byId('search').value.trim() ? searchExpandedGroups : expandedGroups;
  const send = type => vscode.postMessage({ type });
  const buttons = () => {
    byId('connect').disabled = busy || !trusted || connected;
    byId('disconnect').disabled = busy || !connected;
    byId('refresh').disabled = busy || !connected || !trusted;
    byId('execute').hidden = !selected?.executable || !selected?.editor?.supported;
    byId('execute').disabled = busy || !connected || !trusted || !selected?.executable || !selected?.editor?.supported;
    for (const { input } of parameterInputs) input.disabled = busy;
  };
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function markSelection() {
    for (const [button, name] of toolButtons) {
      const active = name === selected?.name;
      button.className = active ? 'tool selected' : 'tool';
      button.setAttribute('aria-pressed', String(active));
    }
  }
  function select(tool) {
    selected = tool;
    byId('detail').hidden = !tool;
    byId('name').textContent = tool?.name ?? '';
    byId('description').textContent = tool?.description || 'No description provided.';
    byId('schema').textContent = tool ? JSON.stringify(tool.inputSchema, null, 2) : '';
    byId('parameters').replaceChildren();
    byId('parameter-error').textContent = '';
    byId('execution-policy').textContent = tool?.executable
      ? (tool.editor?.supported ? 'Authorized read-only query. Edit the optional filters and pagination below.' : tool.editor?.reason || 'Execution unavailable: unsupported input schema.')
      : 'Inspection only. This tool is not authorized for execution.';
    parameterInputs = [];
    const fields = parameters(tool?.inputSchema);
    if (!fields.length) {
      byId('parameters').append(element('p', 'No top-level parameters declared. See the raw schema for composite constraints.'));
    }
    for (const field of fields) {
      const card = element('section'); card.className = 'parameter-card';
      card.append(element('h5', field.name), element('p', `${field.type} · ${field.required ? 'Required' : 'Optional'}`));
      const description = element('details');
      description.append(element('summary', 'Description'), element('p', field.description || 'No description provided.'));
      card.append(description);
      for (const constraint of field.constraints) card.append(element('p', constraint));
      if (!field.constraints.some(constraint => constraint.startsWith('Default:'))) card.append(element('p', 'Schema default: not specified.'));
      const editorField = tool?.executable && tool.editor?.supported ? tool.editor.fields.find(item => item.name === field.name) : undefined;
      if (editorField) {
        if (editorField.default !== undefined) card.append(element('p', `Editor default: ${editorField.default}`));
        if (field.name === 'limit') card.append(element('p', 'Local policy: 1–100 items per query.'));
        const input = element(editorField.enum ? 'select' : 'input');
        input.id = `parameter-${field.name}`;
        if (editorField.enum) {
          const omitted = element('option', 'Not specified'); omitted.value = ''; input.append(omitted);
          for (const value of editorField.enum) { const option = element('option', value); option.value = value; input.append(option); }
        } else {
          input.type = editorField.type === 'integer' ? 'number' : 'text';
          if (editorField.type === 'integer') input.step = '1';
          for (const key of ['minimum', 'maximum', 'minLength', 'maxLength']) {
            if (editorField[key] !== undefined) input.setAttribute({ minimum: 'min', maximum: 'max', minLength: 'minlength', maxLength: 'maxlength' }[key], String(editorField[key]));
          }
        }
        input.value = editorField.default === undefined ? '' : String(editorField.default);
        const label = element('label', `Value for ${field.name}`); label.setAttribute('for', input.id);
        input.required = editorField.required;
        card.append(label, input);
        parameterInputs.push({ field: editorField, input });
      }
      byId('parameters').append(card);
    }
    markSelection(); buttons();
  }
  function render() {
    const query = byId('search').value.trim();
    if (query !== lastQuery) { searchExpandedGroups.clear(); lastQuery = query; }
    const expansion = currentExpansion();
    const groups = groupTools(tools, query);
    const count = groups.reduce((sum, group) => sum + group.tools.length, 0);
    byId('count').textContent = `${count} of ${tools.length} tools`;
    const fragment = document.createDocumentFragment();
    toolButtons = [];
    toolGroups = [];
    for (const group of groups) {
      const section = element('details');
      section.open = expansion.get(group.name) ?? Boolean(query);
      section.addEventListener('toggle', () => expansion.set(group.name, section.open));
      section.className = 'tool-group';
      toolGroups.push([section, group.name]);
      section.append(element('summary', `${group.name} (${group.tools.length})`));
      for (const tool of group.tools) {
        const button = element('button', tool.name);
        button.title = tool.name;
        button.addEventListener('click', () => select(tool));
        toolButtons.push([button, tool.name]); section.append(button);
      }
      fragment.append(section);
    }
    if (!count) fragment.append(element('p', tools.length ? 'No matching tools.' : 'Connect to load tools.'));
    byId('tools').replaceChildren(fragment);
    markSelection();
  }

  // Render data as text nodes only. Bound depth and entries; the original response
  // remains available separately, subject to host redaction and output limits.
  function dataTree(value, budget = { remaining: 200 }, depth = 0) {
    if (--budget.remaining < 0 || depth > 12) return element('span', '[Display limit — see original response]');
    if (value === null || typeof value !== 'object') return element('span', typeof value === 'string' ? value : JSON.stringify(value));
    const entries = Object.entries(value);
    if (!entries.length) return element('span', Array.isArray(value) ? '[]' : '{}');
    const container = element('dl'); container.className = 'data-tree';
    for (const [key, item] of entries) {
      if (budget.remaining <= 0) { container.append(element('dd', '[Display limit — see original response]')); break; }
      container.append(element('dt', Array.isArray(value) ? `Item ${Number(key) + 1}` : key));
      const cell = element('dd'); cell.append(dataTree(item, budget, depth + 1)); container.append(cell);
    }
    return container;
  }
  function renderResult(message) {
    const model = message.pending ? { state: 'pending', sections: [] } : response(message.text, message.isError);
    byId('result-status').textContent = { empty: 'No result yet.', pending: 'Running read-only query…', success: 'Success', error: 'Error' }[model.state];
    byId('result-status').className = `result-${model.state}`;
    byId('result').replaceChildren();
    for (const section of model.sections) {
      byId('result').append(element('h4', section.title), dataTree(section.value));
    }
    if (model.truncated) byId('result').append(element('p', 'Response truncated at the host output limit; structured display is unavailable.'));
    byId('original-response').textContent = message.text || '';
    byId('original-section').hidden = !message.text;
  }
  for (const action of ['connect', 'disconnect', 'refresh']) {
    byId(action).addEventListener('click', () => send(action));
  }
  for (const [id, open] of [['expand-all', true], ['collapse-all', false]]) {
    byId(id).addEventListener('click', () => {
      for (const [section, name] of toolGroups) { section.open = open; currentExpansion().set(name, open); }
    });
  }
  byId('execute').addEventListener('click', () => {
    if (!selected?.executable || !selected.editor?.supported || !trusted || !connected || busy) return;
    const args = {};
    for (const { field, input } of parameterInputs) {
      const value = input.value.trim();
      if (!value) {
        if (field.required && field.default === undefined) { byId('parameter-error').textContent = `${field.name} is required.`; return; }
        continue;
      }
      const item = field.type === 'integer' ? Number(value) : value;
      if ((field.type === 'integer' && (!Number.isSafeInteger(item) || (field.minimum !== undefined && item < field.minimum) || (field.maximum !== undefined && item > field.maximum) || (field.exclusiveMinimum !== undefined && item <= field.exclusiveMinimum) || (field.exclusiveMaximum !== undefined && item >= field.exclusiveMaximum))) ||
          (field.type === 'string' && ((field.minLength !== undefined && [...value].length < field.minLength) || (field.maxLength !== undefined && [...value].length > field.maxLength) || value.length > 4096 || (field.enum && !field.enum.includes(value))))) {
        byId('parameter-error').textContent = `${field.name} does not satisfy its constraints.`; return;
      }
      args[field.name] = item;
    }
    byId('parameter-error').textContent = '';
    vscode.postMessage({ type: 'execute', arguments: args });
  });
  byId('search').addEventListener('input', render);
  window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
      case 'status':
        connected = message.state === 'connected'; trusted = message.trusted; busy = message.busy;
        byId('status').textContent = `${message.state}${trusted ? '' : ' — Workspace is not trusted'}${busy ? ' — Working…' : ''}`;
        buttons(); break;
      case 'tools': {
        const name = selected?.name;
        tools = message.tools;
        render(); select(tools.find(tool => tool.name === name)); break;
      }
      case 'notice': byId('notice').textContent = message.text; break;
      case 'result': renderResult(message); break;
    }
  });
  render(); renderResult({ text: '' }); send('ready');
})();
