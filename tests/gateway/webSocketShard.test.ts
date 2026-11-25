import { GatewayOpcodes } from '@fluxerjs/types';

describe('WebSocketShard connect', () => {
  test('does not open a second socket while one is connecting', async () => {
    let constructed = 0;
    jest.isolateModules(() => {
      class MockWebSocket {
        readyState = 0;
        constructor(_url: string) {
          constructed++;
        }
        send(): void {}
        close(): void {}
        on(): void {}
        addEventListener(): void {}
      }

      const { applyShardPatches } = require('@/gateway') as typeof import('@/gateway');
      const ws = require('@fluxerjs/ws') as typeof import('@fluxerjs/ws');
      applyShardPatches();

      const shard = new ws.WebSocketShard({
        url: 'wss://gateway.fluxer.app',
        token: 'test-token',
        shardId: 0,
        numShards: 1,
        WebSocket: MockWebSocket as any,
      });

      shard.connect();
      shard.connect();
      shard.connect();
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(constructed).toBe(1);
  });

  test('defers reconnect while fast heartbeat grace is active', () => {
    jest.useFakeTimers();
    jest.isolateModules(() => {
      let closed = false;

      class MockWebSocket {
        readyState = 1;
        constructor(_url: string) {}
        send(): void {}
        close(): void {
          closed = true;
        }
        on(): void {}
        addEventListener(): void {}
      }

      const { applyShardPatches } = require('@/gateway') as typeof import('@/gateway');
      const ws = require('@fluxerjs/ws') as typeof import('@fluxerjs/ws');
      applyShardPatches();

      const shard = new ws.WebSocketShard({
        url: 'wss://gateway.fluxer.app',
        token: 'test-token',
        shardId: 0,
        numShards: 1,
        WebSocket: MockWebSocket as any,
      });

      (shard as any).__ccmFastHeartbeatUntil = Date.now() + 60_000;
      (shard as any).seq = 1;
      (shard as any).handleHello({ heartbeat_interval: 1000 });
      jest.advanceTimersByTime(1000);
      expect(closed).toBe(false);
      (shard as any).stopHeartbeat();
    });
    jest.useRealTimers();
  });

  test('records gateway ping from heartbeat ack round-trip', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    jest.isolateModules(() => {
      class MockWebSocket {
        readyState = 1;
        constructor(_url: string) {}
        send(): void {}
        close(): void {}
        on(): void {}
        addEventListener(): void {}
      }

      const { applyShardPatches } = require('@/gateway') as typeof import('@/gateway');
      const ws = require('@fluxerjs/ws') as typeof import('@fluxerjs/ws');
      applyShardPatches();

      const shard = new ws.WebSocketShard({
        url: 'wss://gateway.fluxer.app',
        token: 'test-token',
        shardId: 0,
        numShards: 1,
        WebSocket: MockWebSocket as any,
      });

      (shard as any).lastHeartbeatSentAt = Date.now();
      jest.advanceTimersByTime(42);
      (shard as any).handlePayload({ op: GatewayOpcodes.HeartbeatAck });

      expect((shard as any).ping).toBe(42);
    });
    jest.useRealTimers();
  });
});
