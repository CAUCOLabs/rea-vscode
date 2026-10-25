(() => {
  const api = globalThis.reaSidebarApi;
  const byId = id => document.getElementById(id);
  let trusted = false, connected = false, busy = false, reportAvailable = false;
  let prepared = false, projectCreated = false;
  let canPrepare = false, type = 'web', presentation, hasAnalysisFeedback = false;
  let repositoryAvailable = false;
  let desktopAvailable = false, desktopSupported = false, desktopApplications = [];
  const urls = { web: '', github: '', desktop: '' };
  const targetButtons = { web: 'target-web', github: 'target-github', desktop: 'target-desktop' };
  function buttons() {
    byId('analyze-target').disabled = !trusted || !connected || busy || (type === 'desktop' && (!desktopSupported || !desktopApplications.find(a => a.id === byId('desktop-application').value)?.identityAvailable || !byId('desktop-window').value));
    byId('export-report').disabled = !trusted || !reportAvailable || busy;
    byId('explore-interactions').disabled = !trusted || !connected || !canPrepare || busy;
    byId('prepare-reconstruction').disabled = !trusted || !canPrepare || busy;
    byId('create-reconstruction').hidden = !prepared;
    byId('create-reconstruction').disabled = !trusted || !canPrepare || !prepared || busy;
    byId('generate-with-ai').hidden = !projectCreated;
    byId('generate-with-ai').disabled = !trusted || !projectCreated || busy;
    byId('target-url').disabled = busy || type === 'desktop';
    byId('target-url').hidden = type === 'desktop';
    byId('target-url-label').hidden = type === 'desktop';
    byId('desktop-picker').hidden = type !== 'desktop';
    byId('coming-soon').hidden = type !== 'desktop' || desktopSupported;
    byId('discover-desktop').disabled = !trusted || busy || !desktopSupported;
    byId('desktop-application').disabled = busy || !trusted || !desktopApplications.length;
    byId('desktop-window').disabled = busy || !trusted || !byId('desktop-application').value;
    byId('desktop-screenshot').disabled = busy || !trusted || !desktopSupported;
    byId('desktop-results').hidden = !desktopAvailable || type !== 'desktop';
    byId('export-desktop').disabled = !trusted || !desktopAvailable || busy;
    byId('handoff-desktop').disabled = !trusted || !desktopAvailable || busy;
    byId('reconnect').disabled = busy || !trusted;
    for (const id of Object.values(targetButtons)) byId(id).disabled = busy;
    byId('web-analyzer').setAttribute('aria-busy', String(busy));
    byId('analysis-results').hidden = !reportAvailable || type !== 'web';
    byId('repository-results').hidden = !repositoryAvailable || type !== 'github';
    byId('export-repository').disabled = !trusted || !repositoryAvailable || busy;
    byId('handoff-repository').disabled = !trusted || !repositoryAvailable || busy;
  }
  const node = (tag, text) => { const item = document.createElement(tag); item.textContent = text; return item; };
  function list(id, items, empty, limit = 3) {
    byId(id).replaceChildren();
    for (const value of items.slice(0, limit)) byId(id).append(node('li', value));
    if (!items.length) byId(id).append(node('li', empty));
    if (items.length > limit) byId(id).append(node('li', `+ ${items.length - limit} more in View Analysis`));
  }
  function reset() {
    prepared = false; projectCreated = false; byId('screenshot-preview').replaceChildren();
    byId('scenario-evidence').replaceChildren(); byId('scenario-evidence').hidden = true;
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
      urls[type] = byId('target-url').value;
      type = target;
      byId('target-url').value = urls[type];
      byId('target-url-label').textContent = type === 'github' ? 'GitHub repository URL' : 'Website URL';
      byId('target-url').setAttribute('placeholder', type === 'github' ? 'https://github.com/owner/repository' : 'https://example.com');
      for (const [value, button] of Object.entries(targetButtons)) byId(button).setAttribute('aria-pressed', String(value === type));
      byId('coming-soon').hidden = type !== 'desktop' || desktopSupported;
      byId('coming-soon').textContent = type === 'desktop' && !desktopSupported ? 'Desktop inspection requires a local macOS extension host.' : '';
      byId('analysis-progress').textContent = type === 'desktop' ? 'Discover running applications, select a window, then choose Analyze. No interactions will be performed.' : type === 'github' ? 'Paste a public GitHub repository URL to collect a static snapshot.' : 'Paste a website address to get started.';
      buttons();
    });
  }
  function desktopWindows() {
    const select = byId('desktop-window'); select.replaceChildren();
    const placeholder = node('option', 'Select a window'); placeholder.value = ''; select.append(placeholder); select.value = '';
    const app = desktopApplications.find(a => a.id === byId('desktop-application').value);
    for (const window of app?.windows ?? []) { const option = node('option', `${window.title || 'Untitled window'} · ${window.id}`); option.value = String(window.id); select.append(option); }
    buttons();
  }
  byId('desktop-application').addEventListener('change', desktopWindows);
  byId('desktop-window').addEventListener('change', buttons);
  byId('discover-desktop').addEventListener('click', () => { if (trusted && desktopSupported && !busy) api.postMessage({ type: 'discoverDesktop' }); });
  byId('view-desktop').addEventListener('click', () => {
    byId('desktop-details').hidden = !byId('desktop-details').hidden;
    byId('view-desktop').setAttribute('aria-expanded', String(!byId('desktop-details').hidden));
  });
  byId('export-desktop').addEventListener('click', () => { if (trusted && desktopAvailable && !busy) api.postMessage({ type: 'exportDesktopReport' }); });
  byId('handoff-desktop').addEventListener('click', () => { if (trusted && desktopAvailable && !busy) api.postMessage({ type: 'handoffDesktop' }); });
  byId('view-repository').addEventListener('click', () => {
    byId('repository-details').hidden = !byId('repository-details').hidden;
    byId('view-repository').setAttribute('aria-expanded', String(!byId('repository-details').hidden));
  });
  byId('export-repository').addEventListener('click', () => { if (trusted && repositoryAvailable && !busy) api.postMessage({ type: 'exportRepositoryReport' }); });
  byId('handoff-repository').addEventListener('click', () => { if (trusted && repositoryAvailable && !busy) api.postMessage({ type: 'handoffRepository' }); });
  byId('reconnect').addEventListener('click', () => { if (trusted && !busy) api.postMessage({ type: 'connect' }); });
  byId('open-setup').addEventListener('click', () => api.postMessage({ type: 'openSetup' }));
  byId('analyze-target').addEventListener('click', () => {
    if (!trusted || !connected || busy) return;
    if (type === 'desktop') {
      const app = desktopApplications.find(a => a.id === byId('desktop-application').value);
      const windowId = Number(byId('desktop-window').value);
      if (!desktopSupported || !app?.identityAvailable || !app.windows.some(w => w.id === windowId)) return;
      api.postMessage({ type: 'inspectDesktop', applicationId: app.id, windowId, screenshot: !!byId('desktop-screenshot').checked });
      return;
    }
    const url = byId('target-url').value.trim();
    if (type === 'github') {
      if (!/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/?$/i.test(url) || url.length > 2048) {
        hasAnalysisFeedback = true;
        byId('analysis-progress').textContent = 'Enter a public repository URL such as https://github.com/owner/repository.';
        return;
      }
      api.postMessage({ type: 'analyzeGitHubRepository', url });
      return;
    }
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
  byId('explore-interactions').addEventListener('click', () => {
    if (trusted && connected && canPrepare && !busy) {
      api.postMessage({ type: 'exploreWebInteractions' });
    }
  });
  byId('prepare-reconstruction').addEventListener('click', () => { if (trusted && canPrepare && !busy) api.postMessage({ type: 'prepareReconstruction' }); });
  byId('create-reconstruction').addEventListener('click', () => { if (trusted && canPrepare && prepared && !busy) api.postMessage({ type: 'createReconstructionProject' }); });
  byId('generate-with-ai').addEventListener('click', () => { if (trusted && projectCreated && !busy) api.postMessage({ type: 'generateWithAI' }); });
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
      case 'desktopApplications': {
        desktopApplications = message.applications;
        const select = byId('desktop-application'); select.replaceChildren();
        const placeholder = node('option', 'Select an application'); placeholder.value = ''; select.append(placeholder); select.value = '';
        for (const app of desktopApplications) { const option = node('option', `${app.name} · PID ${app.pid}${app.identityAvailable ? '' : ' · stable launch identity unavailable'}`); option.value = app.id; select.append(option); }
        if (message.message) byId('desktop-permissions').textContent = message.message;
        desktopWindows(); break;
      }
      case 'desktopReset':
        desktopAvailable = false; byId('desktop-report').textContent = ''; byId('desktop-image').replaceChildren();
        byId('desktop-handoff-status').textContent = ''; byId('desktop-details').hidden = true;
        byId('view-desktop').setAttribute('aria-expanded', 'false'); buttons(); break;
      case 'desktopReport': {
        const report = message.report; desktopAvailable = true;
        byId('desktop-summary').textContent = `${report.name} · PID ${report.pid} · window ${report.windowId} · Application discovery: selected application/window found · Accessibility capture: ${report.accessibility} (${report.nodes} nodes)${report.accessibilityReason ? ` — ${report.accessibilityReason}` : ''} · Screenshot capture: ${report.screenshot}${report.screenshotReason ? ` — ${report.screenshotReason}` : ''}. Verified interactions: none. No interactions were performed.`;
        byId('desktop-report').textContent = report.markdown;
        const preview = byId('desktop-image'); preview.replaceChildren();
        const image = report.image;
        if (image && typeof image.base64 === 'string' && image.base64.length <= 20000000 && /^[A-Za-z0-9+/]+={0,2}$/.test(image.base64)) {
          const img = node('img', ''); img.setAttribute('src', `data:image/png;base64,${image.base64}`); img.setAttribute('alt', 'Verified selected application window');
          preview.append(img, node('p', `${image.width} × ${image.height}px · PNG SHA-256 ${image.sha256}`));
        }
        buttons(); break;
      }
      case 'desktopHandoff': byId('desktop-handoff-status').textContent = message.message; break;
      case 'repositoryReset':
        repositoryAvailable = false;
        byId('repository-details').textContent = '';
        byId('repository-handoff-status').textContent = '';
        byId('desktop-details').hidden = true;
  byId('repository-details').hidden = true;
        byId('view-repository').setAttribute('aria-expanded', 'false');
        buttons(); break;
      case 'repositoryReport': {
        const report = message.report;
        repositoryAvailable = true;
        byId('repository-summary').textContent = `${report.target} · ${report.commit} · ${report.entries} entries · ${report.files} captured files · ${report.languages.map(l => l.name).join(', ')} · ${report.dependencies} declared dependencies · REA: ${report.rea}`;
        byId('repository-details').textContent = report.markdown;
        buttons(); break;
      }
      case 'repositoryHandoff': byId('repository-handoff-status').textContent = message.message; break;
      case 'status': {
        desktopSupported = message.desktopSupported === true;
        trusted = message.trusted; connected = message.state === 'connected'; busy = message.busy;
        const connecting = message.state === 'connecting';
        byId('connection-indicator').textContent = !trusted ? 'Workspace not trusted' : connected ? 'Ready' : connecting ? 'Starting REA…' : 'Not connected';
        byId('connection-indicator').className = connected ? 'connection-ready' : 'connection-offline';
        byId('reconnect').hidden = connected || connecting || !trusted;
        if (!trusted) byId('analysis-progress').textContent = 'Trust this workspace in VS Code before analyzing an application.';
        else if (!connected && !connecting) byId('analysis-progress').textContent = message.state === 'error' ? 'REA could not connect. See REA output for details, then choose Reconnect.' : 'The REA connection is closed. Choose Reconnect to continue; see REA output for details.';
        else if (connected && !reportAvailable && !busy && !hasAnalysisFeedback) byId('analysis-progress').textContent = type === 'desktop' ? 'Discover running applications and select a window to inspect.' : type === 'github' ? 'Paste a public GitHub repository URL to get started.' : 'Paste a website address to get started.';
        buttons(); break;
      }
      case 'analysisReset': reset(); byId('analysis-meter').hidden = false; break;
      case 'analysisProgress':
        hasAnalysisFeedback = true;
        byId('analysis-progress').textContent = message.message;
        byId('analysis-meter').value = message.percent;
        byId('analysis-meter').hidden = !busy || message.percent === 0 || message.percent === 100;
        break;
      case 'scenarioEvidence': {
        const evidence = message.evidence;
        if (!evidence || !reportAvailable || evidence.target !== byId('report-target').textContent) break;
        const container = byId('scenario-evidence');
        container.replaceChildren(); container.hidden = false;
        container.append(node('h3', 'REA browser scenario — initial observation'));
        container.append(node('p', 'Captured state only. No clicks, forms or navigation have been tested.'));
        container.append(node('p', `Completeness: ${evidence.completeness || 'unknown'}`));
        if (evidence.screenshot && evidence.screenshot.length <= 20000000 && /^[A-Za-z0-9+/]+={0,2}$/.test(evidence.screenshot)) {
          const img = node('img', '');
          img.setAttribute('src', `data:image/png;base64,${evidence.screenshot}`);
          img.setAttribute('alt', 'REA initial browser scenario screenshot');
          container.append(img);
        }
        for (const [label, content, hash] of [
          ['DOM', evidence.dom, evidence.domHash],
          ['Accessibility', evidence.accessibility, evidence.accessibilityHash]
        ]) {
          const section = document.createElement('details');
          section.append(node('summary', `${label}: ${content ? 'captured' : 'unavailable'}`));
          if (hash) section.append(node('p', `SHA-256: ${hash}`));
          if (content) section.append(node('pre', content));
          container.append(section);
        }
        byId('analysis-detail-panel').hidden = false;
        byId('view-analysis').setAttribute('aria-expanded', 'true');
        break;
      }
      case 'browserDetails': byId('cdp-endpoint').value = message.endpoint; break;
      case 'projectCreated': projectCreated = typeof message.path === 'string' && !!message.path; byId('preparation-status').textContent = message.message; buttons(); break;
      case 'generationPrepared': byId('preparation-status').textContent = message.message; break;
      case 'reconstructionPrepared':
        prepared = true; buttons();
        byId('reconstruction-spec').textContent = message.specification;
        byId('preparation-status').textContent = 'Your coding-agent brief is ready. Export Report includes it. Review missing information before coding.';
        break;
      case 'analysisReport': {
        const report = message.report;
        presentation = message.presentation ?? { status: 'Report needs review', readiness: 'Review the evidence in Advanced before preparing a brief.', canPrepare: false, components: [], interactions: [], resources: [], missing: ['More evidence is needed.'] };
        hasAnalysisFeedback = true;
        reportAvailable = true; canPrepare = presentation.canPrepare;
        byId('analysis-progress').textContent = report.status === 'captured' ? 'Your analysis is ready. Review what was found and what is still unknown.' : (report.evidence?.length ? 'Partial analysis retained. Review the captured evidence and the steps that could not finish in Advanced.' : 'We could not inspect this website. Try again; setup details are available in Advanced.');
        byId('analysis-meter').hidden = true;
        byId('report-target').textContent = report.target;
        byId('evidence-summary').textContent = `${report.target} — ${report.status}. ${report.summary}`;
        byId('reconstruction-spec').textContent = report.specification;
        renderHumanReport(presentation);
        prepared = false; projectCreated = false;
        const preview = byId('screenshot-preview'); preview.replaceChildren();
        const image = report.screenshot;
        if (image && typeof image.dataBase64 === 'string' && image.dataBase64.length <= 20000000 && /^[A-Za-z0-9+/]+={0,2}$/.test(image.dataBase64)) {
          const img = node('img', ''); img.setAttribute('src', `data:image/png;base64,${image.dataBase64}`); img.setAttribute('alt', 'Verified captured viewport');
          preview.append(img, node('p', `${image.width} × ${image.height}px · capture_web_screenshot · ${image.evidenceId} · normalized_result.artifact · PNG SHA-256 ${image.sha256} · Evidence digest ${image.digest}`));
        } else {
          preview.append(node('p', report.findings.filter(f => f.area === 'Visual evidence' && f.classification === 'UNKNOWN').map(f => f.detail).join(' ') || 'No verified screenshot available.'));
        }
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
  byId('desktop-details').hidden = true;
  byId('repository-details').hidden = true;
  reset();
})();
