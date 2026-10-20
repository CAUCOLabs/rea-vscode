import { randomUUID } from 'node:crypto';
import { startAnalysisBrowser, type BrowserLease } from './analysisBrowser';

// Session-local ownership: callers never supply a PID, profile, or endpoint to close.
export class AgentBrowserManager {
  private leases = new Map<string, BrowserLease>();
  private pending = new Set<Promise<unknown>>();
  private shutdown = new AbortController();
  constructor(private readonly start = startAnalysisBrowser) {}

  async acquire(url: string, signal = new AbortController().signal) {
    if (this.shutdown.signal.aborted) throw new Error('Browser manager is closed.');
    const task = this.start({ url, signal: AbortSignal.any([signal, this.shutdown.signal]), allowed: () => !this.shutdown.signal.aborted });
    this.pending.add(task);
    try {
      const lease = await task;
      if (this.shutdown.signal.aborted || signal.aborted) { await lease.close(); throw new Error('Browser request cancelled.'); }
      const lease_id = randomUUID();
      this.leases.set(lease_id, lease);
      return { lease_id, cdp_endpoint: lease.endpoint, target_url: lease.target, allowed_origins: [new URL(lease.target).origin] };
    } finally { this.pending.delete(task); }
  }

  async release(id: string) {
    const lease = this.leases.get(id);
    if (!lease) throw new Error('Unknown browser lease in this MCP session.');
    await lease.close();
    this.leases.delete(id);
    return { released: true };
  }

  async close() {
    this.shutdown.abort();
    await Promise.allSettled([...this.pending]);
    const results = await Promise.allSettled([...this.leases.keys()].map(id => this.release(id)));
    if (results.some(result => result.status === 'rejected')) throw new Error('Some owned browsers could not be cleaned up.');
  }
}
