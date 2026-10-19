(() => {
  const vscode = acquireVsCodeApi();
  const byId = id => document.getElementById(id);
  let tools = [], selected, connected = false, trusted = false, busy = false;
  const send = type => vscode.postMessage({ type });
  const buttons = () => {
    byId('connect').disabled = busy || !trusted || connected;
    byId('disconnect').disabled = busy || !connected;
    byId('refresh').disabled = busy || !connected || !trusted;
    byId('execute').disabled = busy || !connected || !trusted || !selected?.executable;
  };
  function select(tool) {
    selected = tool;
    byId('detail').hidden = !tool;
    byId('name').textContent = tool?.name ?? '';
    byId('description').textContent = tool?.description ?? '';
    byId('schema').textContent = tool ? JSON.stringify(tool.inputSchema, null, 2) : '';
    buttons();
  }
  function render() {
    const query = byId('search').value.toLowerCase();
    const filtered = tools.filter(t => (t.name + ' ' + t.description).toLowerCase().includes(query));
    byId('count').textContent = `${filtered.length} of ${tools.length} tools`;
    const fragment = document.createDocumentFragment();
    for (const tool of filtered) {
      const button = document.createElement('button');
      button.className = 'tool';
      const name = document.createElement('strong'); name.textContent = tool.name;
      const description = document.createElement('span'); description.textContent = tool.description;
      button.append(name, description);
      button.addEventListener('click', () => select(tool));
      fragment.append(button);
    }
    byId('tools').replaceChildren(fragment);
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
      case 'tools': tools = message.tools; select(undefined); render(); break;
      case 'notice': byId('notice').textContent = message.text; break;
      case 'result': byId('result').textContent = message.text || 'No result yet.'; break;
    }
  });
  render(); send('ready');
})();
