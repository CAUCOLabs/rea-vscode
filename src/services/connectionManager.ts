export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error';

export interface ManagedConnection {
  onDidDisconnect?: () => void;
  connect(command: string, args: string[]): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

export class ConnectionManager {
  private state: ConnectionState = 'disconnected';

  private readonly listeners = new Set<() => void>();

  constructor(private readonly client: ManagedConnection) {
    client.onDidDisconnect = () => this.setState('disconnected');
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  getState(): ConnectionState {
    return this.state;
  }

  async connect(command: string, args: string[]): Promise<void> {
    if (this.state !== 'disconnected' && this.state !== 'error') {
      throw new Error(
        `Cannot connect while REA is ${this.state}.`
      );
    }

    this.setState('connecting');

    try {
      await this.client.connect(command, args);
      this.setState('connected');
    } catch (error) {
      this.setState('error');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.state === 'disconnecting') {
      return;
    }

    if (this.state === 'connecting') {
      throw new Error(
        'Cannot disconnect while REA is connecting.'
      );
    }

    this.setState('disconnecting');

    try {
      await this.client.disconnect();
    } finally {
      this.setState('disconnected');
    }
  }

  isConnected(): boolean {
    return (
      this.state === 'connected' &&
      this.client.isConnected()
    );
  }
}
