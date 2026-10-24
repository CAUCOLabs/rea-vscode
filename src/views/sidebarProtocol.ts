export { READ_ONLY_TOOL } from '../services/readOnlyExecution';
export type SidebarAction = 'ready' | 'connect' | 'disconnect' | 'refresh' | 'exportWebReport' | 'prepareReconstruction' | 'createReconstructionProject' | 'exploreWebInteractions' | 'openSetup' | 'exportRepositoryReport' | 'handoffRepository' | 'discoverDesktop' | 'exportDesktopReport' | 'handoffDesktop';
export type SidebarMessage = { type: 'inspectDesktop'; applicationId: string; windowId: number; screenshot: boolean } | { type: SidebarAction } | { type: 'execute'; arguments: Record<string, string | number> } | { type: 'analyzeWebTarget' | 'analyzeGitHubRepository'; url: string };

export function parseSidebarMessage(value: unknown): SidebarMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (record.type === 'analyzeWebTarget' || record.type === 'analyzeGitHubRepository') {
    if (Object.keys(record).length !== 2 || typeof record.url !== 'string' || record.url.length > 2048) return;
    return { type: record.type, url: record.url };
  }
  if (record.type === 'inspectDesktop') {
    if (Object.keys(record).length !== 4 || typeof record.applicationId !== 'string' || !/^[a-f0-9]{24}$/.test(record.applicationId) ||
        !Number.isSafeInteger(record.windowId) || Number(record.windowId) <= 0 || typeof record.screenshot !== 'boolean') return;
    return { type: 'inspectDesktop', applicationId: record.applicationId, windowId: Number(record.windowId), screenshot: record.screenshot };
  }
  if (record.type === 'execute') {
    if (Object.keys(record).length !== 2 || !record.arguments || typeof record.arguments !== 'object' || Array.isArray(record.arguments)) return;
    const entries = Object.entries(record.arguments);
    if (entries.length > 5 || entries.some(([, item]) => !((typeof item === 'string' && item.length <= 4096) || (typeof item === 'number' && Number.isSafeInteger(item))))) return;
    return { type: 'execute', arguments: Object.fromEntries(entries) };
  }
  if (Object.keys(record).length !== 1 || typeof record.type !== 'string') return;
  if (['ready', 'connect', 'disconnect', 'refresh', 'exportWebReport', 'prepareReconstruction', 'createReconstructionProject', 'exploreWebInteractions', 'openSetup', 'exportRepositoryReport', 'handoffRepository', 'discoverDesktop', 'exportDesktopReport', 'handoffDesktop'].includes(record.type)) {
    return { type: record.type as SidebarAction };
  }
}

export { redact, resultText } from '../services/sanitization';
