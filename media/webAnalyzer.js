(() => {
  const api = globalThis.reaSidebarApi;
  const byId = id => document.getElementById(id);
  let trusted = false, connected = false, busy = false, reportAvailable = false;
  let canPrepare = false, type = 'web', presentation, hasAnalysisFeedback = false;
  const targetButtons = { web: 'target-web', github: 'target-github', desktop: 'target-desktop' };
  function buttons() {
    byId('analyze-target').disabled = !trusted || !connected || busy || type !== 'web';
    byId('export-report').disabled = !trusted || !reportAvailable || busy;
    byId('prepare-reconstruction').disabled = !trusted || !canPrepare || busy;
    byId('target-url').disabled = busy || type !== 'web';
    byId('reconnect').disabled = busy || !trusted;
    for (const id of Object.values(targetButtons)) byId(id).disabled = busy;
    byId('web-analyzer').setAttribute('aria-busy', String(busy));
    byId('analysis-results').hidden = !reportAvailable || type !== 'web';
  }
  const node = (tag, text) => { const item = document.createElement(tag); item.textContent = text; return item; };
  function list(id, items, empty, limit = 3) {
    byId(id).replaceChildren();
    for (const value of items.slice(0, limit)) byId(id).append(node('li', value));
    if (!items.length) byId(id).append(node('li', empty));
    if (items.length > limit) byId(id).append(node('li', `+ ${items.length - limit} more in View Analysis`));
  }
  function reset() {
    reportAvailable = false; canPrepare = false; presentation = undefined; hasAnalysisFeedback = false;
    byId('evidence-summary').textContent = 'No analysis yet.';
    byId('analysis-findings').replaceChildren();
    byId('human-findings').replaceChildren();
    byId('reconstruction-spec').textContent = 'Prepare a reconstruction brief after analyzing.';
    byId('preparation-status').textContent = '';
    byId('analysis-meter').value = 0;
    byId('analysis-detail-panel').hidden = true;
    byId('view-analysis').setAttribute('aria-expanded', 'false');
    buttons();
  }
  for (const [target, id] of Object.entries(targetButtons)) {
    byId(id).addEventListener('click', () => {
      if (busy) return;
      type = target;
      for (const [value, button] of Object.entries(targetButtons)) byId(button).setAttribute('aria-pressed', String(value === type));
      byId('coming-soon').hidden = type === 'web';
      byId('coming-soon').textContent = type === 'web' ? '' : `${type === 'github' ? 'GitHub' : 'Desktop App'} analysis is coming soon. Choose Web to analyze a website.`;
      buttons();
    });
  }
  byId('reconnect').addEventListener('click', () => { if (trusted && !busy) api.postMessage({ type: 'connect' }); });
  byId('open-setup').addEventListener('click', () => api.postMessage({ type: 'openSetup' }));
  byId('analyze-target').addEventListener('click', () => {
    if (!trusted || !connected || busy || type !== 'web') return;
    const url = byId('target-url').value.trim();
    let parsed;
    try { parsed = new URL(url); } catch { /* Human-readable validation below. */ }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || url.length > 2048) {
      hasAnalysisFeedback = true;
      byId('analysis-progress').textContent = 'Paste a complete website address, such as https://example.com, without a username or password.'; return;
    }
    api.postMessage({ type: 'analyzeWebTarget', url });
  });
  byId('target-url').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); byId('analyze-target').click(); } });
  byId('export-report').addEventListener('click', () => { if (trusted && reportAvailable && !busy) api.postMessage({ type: 'exportWebReport' }); });
  byId('prepare-reconstruction').addEventListener('click', () => { if (trusted && canPrepare && !busy) api.postMessage({ type: 'prepareReconstruction' }); });
  byId('view-analysis').addEventListener('click', () => {
    const open = byId('analysis-detail-panel').hidden;
    byId('analysis-detail-panel').hidden = !open;
    byId('view-analysis').setAttribute('aria-expanded', String(open));
  });
  function renderHumanReport(view) {
    byId('analysis-status').textContent = view.status;
    byId('report-readiness').textContent = view.readiness;
    list('component-summary', view.components, 'No components could be identified.');
    list('interaction-summary', view.interactions, 'No interactions were verified.');
    list('resource-summary', view.resources, 'No resources or technologies could be identified.');
    list('missing-summary', view.missing, 'Review the full analysis before implementation.', 4);
    byId('human-findings').replaceChildren();
    for (const [title, items] of [['Components',view.components],['Controls and navigation',view.interactions],['Resources and possible technologies',view.resources],['Information still needed',view.missing]]) {
      const section = document.createElement('section'); section.append(node('h3', title));
      for (const item of items) section.append(node('p', item));
      byId('human-findings').append(section);
    }
  }
  window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
      case 'status': {
        trusted = message.trusted; connected = message.state === 'connected'; busy = message.busy;
        const connecting = message.state === 'connecting' || (!connected && busy);
        byId('connection-indicator').textContent = !trusted ? 'Workspace not trusted' : connected ? 'Ready' : connecting ? 'Starting REA…' : 'Not connected';
        byId('connection-indicator').className = connected ? 'connection-ready' : 'connection-offline';
        byId('reconnect').hidden = connected || connecting || !trusted;
        if (!trusted) byId('analysis-progress').textContent = 'Trust this workspace in VS Code before analyzing a website.';
        else if (!connected && !connecting) byId('analysis-progress').textContent = 'REA could not connect. Check the installation in Advanced, then choose Reconnect.';
        else if (connected && !reportAvailable && !busy && !hasAnalysisFeedback) byId('analysis-progress').textContent = 'Paste a website address to get started.';
        buttons(); break;
      }
      case 'analysisReset': reset(); byId('analysis-meter').hidden = false; break;
      case 'analysisProgress':
        hasAnalysisFeedback = true;
        byId('analysis-progress').textContent = message.message;
        byId('analysis-meter').value = message.percent;
        byId('analysis-meter').hidden = !busy || message.percent === 0;
        break;
      case 'browserDetails': byId('cdp-endpoint').value = message.endpoint; break;
      case 'reconstructionPrepared':
        byId('reconstruction-spec').textContent = message.specification;
        byId('preparation-status').textContent = 'Your coding-agent brief is ready. Export Report includes it. Review missing information before coding.';
        break;
      case 'analysisReport': {
        const report = message.report;
        presentation = message.presentation ?? { status: 'Report needs review', readiness: 'Review the evidence in Advanced before preparing a brief.', canPrepare: false, components: [], interactions: [], resources: [], missing: ['More evidence is needed.'] };
        hasAnalysisFeedback = true;
        reportAvailable = true; canPrepare = presentation.canPrepare;
        byId('analysis-progress').textContent = report.status === 'captured' ? 'Your analysis is ready. Review what was found and what is still unknown.' : 'We could not inspect this website. Try again; setup details are available in Advanced.';
        byId('analysis-meter').hidden = true;
        byId('report-target').textContent = report.target;
        byId('evidence-summary').textContent = `${report.target} — ${report.status}. ${report.summary}`;
        byId('reconstruction-spec').textContent = report.specification;
        renderHumanReport(presentation);
        // Full provenance stays available only inside Advanced.
        byId('analysis-findings').replaceChildren();
        for (const classification of ['OBSERVED','INFERRED','UNKNOWN']) {
          const section = document.createElement('details');
          const findings = report.findings.filter(item => item.classification === classification);
          section.append(node('summary', `${classification} (${findings.length})`));
          for (const finding of findings) {
            const card = document.createElement('article'); card.className = 'finding-card';
            card.append(node('strong', `${finding.id} · ${finding.area}`), node('p', finding.detail), node('p', `${finding.source} · ${finding.evidenceId} · ${finding.path || 'workflow policy/diagnostic'}`));
            section.append(card);
          }
          byId('analysis-findings').append(section);
        }
        buttons(); break;
      }
    }
  });
  reset();
})();
