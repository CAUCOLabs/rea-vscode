import type { WebReport } from './webTargetAnalyzer';
import { safeText } from './webTargetAnalyzer';

export interface AnalysisPresentation {
  status: string; readiness: string; canPrepare: boolean;
  components: string[]; interactions: string[]; resources: string[]; missing: string[];
}
export function presentAnalysis(report: WebReport): AnalysisPresentation {
  const components: string[] = [];
  const interactions: string[] = [];
  const resources: string[] = [];
  for (const finding of report.findings) {
    if (finding.classification === 'OBSERVED' && finding.area === 'Interface structure') {
      const json = /Retained semantic DOM nodes: (\{.*?\})\./.exec(finding.detail)?.[1];
      if (json) {
        try {
          const names: Record<string, string> = { header: 'Header', nav: 'Navigation', main: 'Main content', section: 'Section', article: 'Article', aside: 'Side content', footer: 'Footer', form: 'Form', h1: 'Main heading', h2: 'Heading', h3: 'Subheading', a: 'Link', button: 'Button', input: 'Input', select: 'Selection', textarea: 'Text area' };
          for (const [tag, count] of Object.entries(JSON.parse(json))) if (names[tag] && typeof count === 'number' && count > 0) components.push(`${names[tag]} (${count})`);
        } catch { /* Do not manufacture component names from incompatible evidence. */ }
      }
    }
    if (finding.classification === 'OBSERVED' && ['Interface controls','Navigation'].includes(finding.area)) {
      const match = /^Accessibility role=([^;]+); label=(.*?); states=/.exec(finding.detail);
      if (match) {
        const role = ({ textbox: 'Text input', searchbox: 'Search', combobox: 'Selection', menuitem: 'Menu item' } as Record<string, string>)[match[1]] ?? match[1].replace(/^./, char => char.toUpperCase());
        components.push(safeText(`${role}: ${match[2]}`));
        if (['button','link','textbox','searchbox','combobox','checkbox','radio','tab','menuitem'].includes(match[1])) interactions.push(safeText(`${role}: ${match[2]} — present, behavior not tested.`));
      }
    }
    if (finding.classification === 'OBSERVED' && finding.area === 'Resources') resources.push(safeText(finding.detail));
    if (finding.classification === 'INFERRED' && finding.area === 'Technology candidates') {
      const value = finding.detail.split('; provider confidence=')[0].replace(/^[^:]+:\s*/, '');
      resources.push(safeText(`Possible technology: ${value}. Needs confirmation.`));
    }
  }
  const unique = (values: string[]) => [...new Set(values)].slice(0, 30);
  const captured = report.status === 'captured';
  const canPrepare = captured && components.length > 0;
  const hasPage = captured || report.evidence.some(e => e.tool === 'inspect_web_page');
  const missing = hasPage ? [
    'Navigation declarations are observed, but clicks, forms and component behavior have not been tested; this workflow has no authorized interaction tool.',
    'Backend logic, private features and complete data requirements are unknown.',
    report.screenshot ? 'A verified screenshot of one viewport is available in Analysis details; geometry, computed styles and additional viewport sizes remain unknown.' : 'No verified screenshot is available. See Analysis details for the capture diagnostic; visual layout remains unknown.',
    'This is a limited snapshot; network activity and some resources may be missing.'
  ] : ['The website was not inspected. Retry; if this continues, check setup in Advanced. No reconstruction claims can be made.'];
  if (!captured && hasPage) missing.push('Partial analysis retained: some operations failed. Review Analysis details before using the evidence.');
  if (report.findings.some(f => f.area === 'Connection')) missing.push('The analysis connection was lost. Reconnect before collecting further evidence.');
  if (report.findings.some(f => f.area === 'Redirect')) missing.push('The website redirected. Only the final page was inspected.');
  if (report.findings.some(f => f.classification === 'UNKNOWN' && f.area === 'JavaScript analysis')) missing.push('Some scripts could not be analyzed.');
  return {
    status: captured ? 'Page inspected' : 'Analysis incomplete',
    readiness: canPrepare ? 'Enough evidence for an initial UI brief. Functional reconstruction needs more information.' : 'More evidence is needed before preparing a reconstruction brief.',
    canPrepare, components: unique(components), interactions: unique(interactions), resources: unique(resources), missing
  };
}
