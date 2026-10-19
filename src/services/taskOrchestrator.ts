import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ReaMcpClient } from '../mcp/client';

export type ReaTask = 'website' | 'browser' | 'desktop' | 'source' | 'binary' | 'reconstruction';
const relevance: Record<ReaTask, RegExp> = {
  website: /web|javascript|browser/,
  browser: /browser|web_page|web_session|web_screenshot|webmcp/,
  desktop: /native_ui|electron|process_scenario|adb|binary_session/,
  source: /javascript|source|module|android_class|managed/,
  binary: /binary|native|macho|signature|objdump|rizin|procedure|assembly|bytes/,
  reconstruction: /evidence|reconstruction|capture|compare|unknown|feature/
};
export interface ToolStep { name: string; arguments: Record<string, unknown>; }

export class TaskOrchestrator {
  constructor(private readonly client: ReaMcpClient) {}
  candidates(task: ReaTask): readonly Tool[] {
    // Recommendations only. The entire catalog remains callable, including new tools.
    return this.client.getTools().filter(tool => relevance[task].test(`${tool.name} ${tool.description ?? ''}`));
  }
  async run(steps: readonly ToolStep[], authorize: (tool: Tool, args: Record<string, unknown>) => Promise<boolean>, signal?: AbortSignal) {
    const results = [];
    for (const step of steps) {
      signal?.throwIfAborted();
      const result = await this.client.invokeTool(step.name, step.arguments, { signal, timeout: 300_000 }, authorize);
      results.push({ name: step.name, result });
      if (result.isError) break; // No retries: a failed mutation may have partly completed.
    }
    return results;
  }
}
