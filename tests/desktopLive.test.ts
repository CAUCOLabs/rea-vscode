import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { discoverDesktopApplications, type DesktopApplication } from '../src/services/desktopDiscovery';
import { analyzeDesktopApplication } from '../src/analysis/desktopAnalyzer';
import { createDesktopHandoff } from '../src/services/desktopHandoff';
import { initializeEngineRuntime, resolveEngineLaunch } from '../src/services/engineRuntime';
import { ReaMcpClient } from '../src/mcp/client';

it.skipIf(!process.env.REA_DESKTOP_LIVE || process.platform !== 'darwin')('inspects the fixed native fixture through real macOS APIs and original REA without interactions', async () => {
  const output = resolve('build/desktop-validation');
  const executable = resolve(output, 'REAReadOnlyFixture.app/Contents/MacOS/REAReadOnlyFixture');
  await access(executable); // Compile only the checked-in fixed fixture before opting in.
  // LaunchServices supplies the stable launchDate required by REA's PID-reuse checks.
  const fixture = spawn('/usr/bin/open', ['-n', '-W', resolve(output, 'REAReadOnlyFixture.app')], { stdio: 'ignore' });
  let owned: DesktopApplication | undefined;
  const signal = AbortSignal.timeout(180000);
  let client: ReaMcpClient | undefined;
  try {
    await delay(1200, undefined, { signal });
    const discovery = await discoverDesktopApplications(signal);
    const app = discovery.applications.find(a => a.executable === executable && a.bundleId === 'org.caucolabs.rea.readonly-fixture');
    await writeFile(resolve(output, 'discovery.json'), JSON.stringify({ applications: app ? [app] : [], permissions: discovery.permissions, windowServerAvailable: discovery.windowServerAvailable }, null, 2));
    expect(app, 'Native fixture must appear as the exact spawned running application').toBeDefined();
    expect(app!.launchTime).not.toBeNull();
    owned = app;
    const window = app!.windows.find(w => w.title === 'REA Native Read-only Fixture');
    expect(window).toBeDefined();
    initializeEngineRuntime(process.cwd());
    const launch = await resolveEngineLaunch();
    const report = await analyzeDesktopApplication({ application: app!, windowId: window!.id, screenshot: true, signal, allowed: () => true, launch });
    client = new ReaMcpClient();
    await client.connect(launch.command, launch.args);
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    expect(client!.getTools()).toHaveLength(207);
    expect(report.accessibility.status).toBe(discovery.permissions.accessibility ? 'captured' : 'permission-denied');
    if (discovery.permissions.accessibility) {
      expect(report.accessibility.nodes.some(n => n.role === 'AXButton')).toBe(true);
      expect(report.accessibility.nodes.some(n => n.role === 'AXTextField')).toBe(true);
      expect(report.menu.status).toBe('captured');
    }
    expect(report.screenshot.status).toBe(discovery.permissions.screenCapture ? 'captured' : 'permission-denied');
    expect(report.verifiedInteractions).toEqual([]);
    const handoff = await createDesktopHandoff(output, report);
    const evidence = JSON.parse(await readFile(resolve(handoff, 'desktop-evidence.json'), 'utf8'));
    expect(evidence.application.pid).toBe(app!.pid);
    expect(evidence.windowId).toBe(window!.id);
    expect(evidence.accessibility.response).toEqual(report.accessibility.response);
    if (report.screenshot.image) {
      const png = await readFile(resolve(handoff, 'evidence/window.png'));
      expect(createHash('sha256').update(png).digest('hex')).toBe(report.screenshot.image.sha256);
    }
    expect(await readFile(resolve(handoff, 'agent-handoff.md'), 'utf8')).toContain('Codex or Copilot');
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, 'validation.json'), JSON.stringify({ application: app!.name, bundleId: app!.bundleId, windowId: window!.id, tools: client!.getTools().length,
      accessibility: report.accessibility.status, nodes: report.accessibility.nodes.length, roles: [...new Set(report.accessibility.nodes.map(n => n.role))],
      menus: report.menu, screenshot: report.screenshot.status, image: report.screenshot.image ? { sha256: report.screenshot.image.sha256, width: report.screenshot.image.width, height: report.screenshot.image.height } : null,
      verifiedInteractions: 0, handoff, sourceCodeAcquired: false }, null, 2));
  } finally {
    await client?.disconnect();
    // Terminate only the owned fixture process, never an arbitrary inspected application.
    if (owned) {
      const fresh = await discoverDesktopApplications(AbortSignal.timeout(60000)).catch(() => undefined);
      if (fresh?.applications.some(a => a.pid === owned!.pid && a.executable === owned!.executable && a.launchTime === owned!.launchTime)) process.kill(owned.pid, 'SIGTERM');
    }
    if (fixture.exitCode === null && fixture.signalCode === null) fixture.kill('SIGTERM');
  }
}, 200000);
