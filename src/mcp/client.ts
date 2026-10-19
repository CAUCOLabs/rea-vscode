import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class ReaMcpClient {
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;

  async connect(command: string, args: string[]): Promise<void> {
    if (this.client) {
      throw new Error('REA is already connected.');
    }

    const client = new Client({
      name: 'rea-vscode',
      version: '0.1.0'
    });

    const transport = new StdioClientTransport({
      command,
      args,
      stderr: 'pipe'
    });

    try {
      await client.connect(transport);

      this.client = client;
      this.transport = transport;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async listTools() {
    if (!this.client) {
      throw new Error('REA is not connected.');
    }

    const tools = [];
    let cursor: string | undefined;

    do {
      const result = await this.client.listTools(
        cursor ? { cursor } : undefined
      );

      tools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);

    return tools;
  }

  async disconnect(): Promise<void> {
    const client = this.client;

    this.client = undefined;
    this.transport = undefined;

    if (client) {
      await client.close();
    }
  }

  isConnected(): boolean {
    return this.client !== undefined;
  }
}
