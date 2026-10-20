import { describe, expect, it, vi } from 'vitest';

import {
  ConnectionManager,
  type ManagedConnection
} from '../src/services/connectionManager';

function createClient(): ManagedConnection {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true)
  };
}

describe('ConnectionManager', () => {
  it('starts disconnected', () => {
    const manager = new ConnectionManager(createClient());

    expect(manager.getState()).toBe('disconnected');
  });

  it('connects successfully', async () => {
    const manager = new ConnectionManager(createClient());

    await manager.connect('node', ['rea.mjs', 'mcp']);

    expect(manager.getState()).toBe('connected');
    expect(manager.isConnected()).toBe(true);
  });

  it('prevents duplicate connections', async () => {
    const client = createClient();
    const manager = new ConnectionManager(client);

    await manager.connect('node', ['rea.mjs', 'mcp']);

    await expect(
      manager.connect('node', ['rea.mjs', 'mcp'])
    ).rejects.toThrow('Cannot connect');

    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('disconnects successfully', async () => {
    const manager = new ConnectionManager(createClient());

    await manager.connect('node', ['rea.mjs', 'mcp']);
    await manager.disconnect();

    expect(manager.getState()).toBe('disconnected');
  });

  it('does not announce connected when the transport closes during initialization', async () => {
    const client = createClient();
    vi.mocked(client.connect).mockImplementationOnce(async () => {
      vi.mocked(client.isConnected).mockReturnValue(false);
      client.onDidDisconnect?.();
    });
    const manager = new ConnectionManager(client);
    await expect(manager.connect('node', [])).rejects.toThrow('transport closed');
    expect(manager.isConnected()).toBe(false);
    expect(manager.getState()).toBe('error');
  });

  it('records connection failures', async () => {
    const client = createClient();

    vi.mocked(client.connect).mockRejectedValueOnce(
      new Error('MCP startup failed')
    );

    const manager = new ConnectionManager(client);

    await expect(
      manager.connect('node', ['rea.mjs', 'mcp'])
    ).rejects.toThrow('MCP startup failed');

    expect(manager.getState()).toBe('error');
  });

  it('blocks concurrent connection attempts', async () => {
    let finishConnection!: () => void;

    const client = createClient();

    vi.mocked(client.connect).mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        finishConnection = resolve;
      })
    );

    const manager = new ConnectionManager(client);

    const first = manager.connect('node', ['rea.mjs', 'mcp']);

    expect(manager.getState()).toBe('connecting');

    await expect(
      manager.connect('node', ['rea.mjs', 'mcp'])
    ).rejects.toThrow('Cannot connect');

    expect(client.connect).toHaveBeenCalledTimes(1);

    finishConnection();
    await first;

    expect(manager.getState()).toBe('connected');
  });
  it('notifies subscribers when the MCP client closes unexpectedly', async () => {
    const client = createClient();
    const manager = new ConnectionManager(client);
    const changed = vi.fn();
    const subscription = manager.onDidChange(changed);
    await manager.connect('node', []);
    client.onDidDisconnect?.();
    expect(manager.getState()).toBe('disconnected');
    expect(manager.isConnected()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(3);
    subscription.dispose();
  });

});
