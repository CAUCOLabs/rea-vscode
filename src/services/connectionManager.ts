export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error';

export interface ManagedConnection {
  connect(command: string, args: string[]): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

export class ConnectionManager {
  private state: ConnectionState = 'disconnected';

  constructor(
    private readonly client: ManagedConnection
  ) {}

  getState(): ConnectionState {
    return this.state;
  }

  async connect(command: string, args: string[]): Promise<void> {
    if (this.state !== 'disconnected' && this.state !== 'error') {
      throw new Error(
        `Cannot connect while REA is ${this.state}.`
      );
    }

    this.state = 'connecting';

    try {
      await this.client.connect(command, args);
      this.state = 'connected';
    } catch (error) {
      this.state = 'error';
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

    this.state = 'disconnecting';

    try {
      await this.client.disconnect();
    } finally {
      this.state = 'disconnected';
    }
  }

  isConnected(): boolean {
    return (
      this.state === 'connected' &&
      this.client.isConnected()
    );
  }
}
