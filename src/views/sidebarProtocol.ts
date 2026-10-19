export { READ_ONLY_TOOL } from '../services/readOnlyExecution';
export type SidebarAction = 'ready' | 'connect' | 'disconnect' | 'refresh' | 'exportWebReport' | 'prepareReconstruction' | 'openSetup';
export type SidebarMessage = { type: SidebarAction } | { type: 'execute'; arguments: Record<string, string | number> } | { type: 'analyzeWebTarget'; url: string };

export function parseSidebarMessage(value: unknown): SidebarMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (record.type === 'analyzeWebTarget') {
    if (Object.keys(record).length !== 2 || typeof record.url !== 'string' || record.url.length > 2048) return;
    return { type: 'analyzeWebTarget', url: record.url };
  }
  if (record.type === 'execute') {
    if (Object.keys(record).length !== 2 || !record.arguments || typeof record.arguments !== 'object' || Array.isArray(record.arguments)) return;
    const entries = Object.entries(record.arguments);
    if (entries.length > 5 || entries.some(([, item]) => !((typeof item === 'string' && item.length <= 4096) || (typeof item === 'number' && Number.isSafeInteger(item))))) return;
    return { type: 'execute', arguments: Object.fromEntries(entries) };
  }
  if (Object.keys(record).length !== 1 || typeof record.type !== 'string') return;
  if (['ready', 'connect', 'disconnect', 'refresh', 'exportWebReport', 'prepareReconstruction', 'openSetup'].includes(record.type)) {
    return { type: record.type as SidebarAction };
  }
}

export { redact, resultText } from '../services/sanitization';
