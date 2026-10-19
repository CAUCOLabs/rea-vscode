(() => {
  const vscode = acquireVsCodeApi();
  const { groupTools, parameters, response } = globalThis.reaSidebarModel;
  const byId = id => document.getElementById(id);
  let tools = [], selected, connected = false, trusted = false, busy = false;
  let toolButtons = [];
  const send = type => vscode.postMessage({ type });
  const buttons = () => {
    byId('connect').disabled = busy || !trusted || connected;
    byId('disconnect').disabled = busy || !connected;
    byId('refresh').disabled = busy || !connected || !trusted;
    byId('execute').disabled = busy || !connected || !trusted || !selected?.executable;
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
    const fields = parameters(tool?.inputSchema);
    if (!fields.length) {
      byId('parameters').append(element('p', 'No top-level parameters declared. See the raw schema for composite constraints.'));
    } else {
      const table = element('table');
      const head = element('tr');
      for (const label of ['Parameter', 'Type / requirement', 'Description / constraints']) head.append(element('th', label));
      const thead = element('thead'); thead.append(head); table.append(thead);
      const body = element('tbody');
      for (const field of fields) {
        const row = element('tr');
        row.append(element('th', field.name), element('td', `${field.type}\n${field.required ? 'Required' : 'Optional'}`));
        const detail = element('td');
        detail.append(element('p', field.description || 'No description provided.'));
        for (const constraint of field.constraints) detail.append(element('p', constraint));
        row.append(detail); body.append(row);
      }
      table.append(body); byId('parameters').append(table);
    }
    markSelection(); buttons();
  }
  function render() {
    const groups = groupTools(tools, byId('search').value);
    const count = groups.reduce((sum, group) => sum + group.tools.length, 0);
    byId('count').textContent = `${count} of ${tools.length} tools`;
    const fragment = document.createDocumentFragment();
    toolButtons = [];
    for (const group of groups) {
      const section = element('details'); section.open = true;
      section.className = 'tool-group';
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
  for (const action of ['connect', 'disconnect', 'refresh', 'execute']) {
    byId(action).addEventListener('click', () => send(action));
  }
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
