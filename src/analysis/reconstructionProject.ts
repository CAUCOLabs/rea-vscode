import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { presentAnalysis } from './analysisPresentation';
import type { WebReport } from './webTargetAnalyzer';

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export function reconstructionFiles(report: WebReport): Record<string, string | Buffer> {
  if (!presentAnalysis(report).canPrepare) throw new Error('Observed interface evidence is required.');
  const observed = report.findings.filter(f => f.classification === 'OBSERVED');
  const controls = observed.filter(f => ['Interface controls', 'Navigation'].includes(f.area)).flatMap(f => {
    const match = /^Accessibility role=([^;]+); label=(.*?); states=/.exec(f.detail);
    if (!match) return [];
    const label = escape(match[2]);
    return [match[1] === 'heading' ? `<h2>${label}</h2>` : match[1] === 'link' ? `<span class="placeholder">${label} — destination unverified</span>` : ['textbox','searchbox'].includes(match[1]) ? `<label>${label}<input disabled placeholder="Behavior unknown"></label>` : match[1] === 'button' ? `<button disabled>${label}</button>` : `<p>${label}</p>`];
  });
  const model = { target: report.target, createdAt: report.createdAt, structure: observed.filter(f => f.area === 'Interface structure'), components: observed.filter(f => ['Interface controls','Navigation'].includes(f.area)), navigation: observed.filter(f => f.area === 'Navigation declarations'), visualEvidence: report.evidence.filter(e => e.artifact), unknowns: report.findings.filter(f => f.classification === 'UNKNOWN') };
  return {
    'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'"><title>Original reconstruction starter</title><link rel="stylesheet" href="styles.css"></head><body><header><h1>Reconstruction starter</h1><p>Original static interpretation of observed evidence.</p></header><nav aria-label="Starter sections"><a href="#observed">Observed interface</a> <a href="#limitations">Limitations</a></nav><main><section id="observed">${controls.join('\n')}</section><section id="limitations"><h2>Unknown functionality</h2><p>Controls are placeholders. Navigation declarations are recorded in evidence.json; destinations have not been followed. Backend, search, authentication and action outcomes are unknown. No functional or backend equivalence is claimed.</p></section>${report.screenshot ? '<figure><img src="evidence/viewport.png" alt="Verified source viewport evidence"><figcaption>Source evidence, not generated UI. See evidence.json for provenance.</figcaption></figure>' : '<p>No verified screenshot available. See evidence.json for the capture diagnostic.</p>'}</main><footer>Original styling; layout and responsive equivalence unverified.</footer></body></html>`,
    'styles.css': 'body{font:16px/1.6 system-ui,sans-serif;max-width:960px;margin:auto;padding:24px;color:#193047;background:#f5f7fa}header,section,footer{padding:24px;margin:16px 0;background:white;border-radius:12px}nav{display:flex;gap:24px}button,input,.placeholder{display:block;margin:12px 0;padding:10px}img{max-width:100%;height:auto}',
    'evidence.json': JSON.stringify(model, null, 2),
    'README.md': '# Original reconstruction starter\n\nOpen index.html in a browser. No dependencies or backend. Based only on observed evidence; controls intentionally remain placeholders. Review evidence.json for structure, navigation declarations, unknowns and visual provenance. The local tests/fixtures/web-target fixture is the first supported manual target. No functional, backend or pixel equivalence is claimed.\n',
    'reconstruction-brief.md': report.specification,
    ...(report.screenshot ? { 'evidence/viewport.png': Buffer.from(report.screenshot.dataBase64, 'base64') } : {})
  };
}

// Always create a fresh child directory atomically. Existing files, directories
// and symlinks are never traversed or overwritten; no overwrite mode exists.
export async function createReconstructionProject(parent: string, report: WebReport, name = 'rea-reconstruction'): Promise<string> {
  if (!/^rea-reconstruction(?:-[a-zA-Z0-9-]+)?$/.test(name)) throw new Error('Invalid project directory name.');
  const files = reconstructionFiles(report);
  const destination = join(parent, name);
  await mkdir(destination);
  try {
    if (report.screenshot) await mkdir(join(destination, 'evidence'));
    for (const [relative, content] of Object.entries(files)) await writeFile(join(destination, relative), content, { flag: 'wx' });
    return destination;
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}
