import { EventEmitter } from 'events';
import { GatewayOpcodes } from '@fluxerjs/types';

type HelloShard = EventEmitter & {
  sessionId: string | null;
  seq: number | null;
  send: jest.Mock;
  connect: jest.Mock;
  ws: null;
  destroying: boolean;
  options: { token: string; intents: number };
  heartbeatAt: number;
  startHeartbeat: jest.Mock;
  sendHeartbeat: jest.Mock;
  stopHeartbeat: () => void;
  id: number;
  heartbeatTimeout?: ReturnType<typeof setTimeout> | null;
  heartbeatInterval?: ReturnType<typeof setInterval> | null;
};

function makeResumeShard(): HelloShard {
  const shard = Object.assign(new EventEmitter(), {
    sessionId: 'sess' as string | null,
    seq: 1 as number | null,
    send: jest.fn(),
    connect: jest.fn(),
    ws: null,
    destroying: false,
    options: { token: 'tok', intents: 0 },
    heartbeatAt: 0,
    startHeartbeat: jest.fn(),
    sendHeartbeat: jest.fn(),
    id: 0,
    heartbeatTimeout: null as ReturnType<typeof setTimeout> | null,
    heartbeatInterval: null as ReturnType<typeof setInterval> | null,
    // Real handleHello calls this and also leaves a timer afterward — clear both.
    stopHeartbeat() {
      if (this.heartbeatTimeout != null) {
        clearTimeout(this.heartbeatTimeout);
        this.heartbeatTimeout = null;
      }
      if (this.heartbeatInterval != null) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
    },
  }) as HelloShard;
  return shard;
}

describe('gatewayManager resume watchers', () => {
  test('cleans up fast heartbeats on ready and replaces older hello timers', () => {
    jest.useFakeTimers();
    jest.isolateModules(() => {
      const onFastHeartbeatDone = jest.fn();
      const { setupGateway } = require('@/gateway') as typeof import('@/gateway');
      const { WebSocketShard } = require('@fluxerjs/ws') as typeof import('@fluxerjs/ws');

      setupGateway({
        fastHeartbeatMs: 500,
        fastHeartbeatDurationMs: 30_000,
        onFastHeartbeatDone,
      });

      const shard = makeResumeShard();
      const socket = { readyState: 1 };
      (shard as any).ws = socket;
      const send = jest.fn();
      (shard as any).send = send;
      const handleHello = (WebSocketShard.prototype as any).handleHello as (data: {
        heartbeat_interval: number;
      }) => void;
      const heartbeatCount = () =>
        send.mock.calls.filter(([payload]) => payload?.op === GatewayOpcodes.Heartbeat).length;

      try {
        handleHello.call(shard, { heartbeat_interval: 41_250 });
        jest.advanceTimersByTime(750);
        expect(heartbeatCount()).toBe(2);

        handleHello.call(shard, { heartbeat_interval: 41_250 });
        jest.advanceTimersByTime(1_000);
        expect(heartbeatCount()).toBe(5);

        shard.emit('ready');
        const countWhenReady = heartbeatCount();
        jest.advanceTimersByTime(30_000);

        expect(heartbeatCount()).toBe(countWhenReady);
        expect(onFastHeartbeatDone).not.toHaveBeenCalled();
      } finally {
        (shard as any).__ccmFastHeartbeatCleanup?.();
        shard.stopHeartbeat();
        jest.useRealTimers();
      }
    });
  });

  test('does not stack ready listeners when Hello fires repeatedly', () => {
    jest.isolateModules(() => {
      const { setupGateway } = require('@/gateway') as typeof import('@/gateway');
      const { WebSocketShard } = require('@fluxerjs/ws') as typeof import('@fluxerjs/ws');

      setupGateway({
        resumeConfirmTimeoutMs: 10_000,
        restoreSession: () => ({ sessionId: 'sess', seq: 1 }),
        clearRestoredSession: () => {},
      });

      const shard = makeResumeShard();

      const handleHello = (WebSocketShard.prototype as any).handleHello as (data: {
        heartbeat_interval: number;
      }) => void;
      const helloData = { heartbeat_interval: 41_250 };

      try {
        for (let i = 0; i < 12; i++) {
          handleHello.call(shard, helloData);
        }

        expect(shard.listenerCount('ready')).toBeLessThanOrEqual(1);
        expect(shard.listenerCount('resumed')).toBeLessThanOrEqual(1);
        expect(shard.listenerCount('dispatch')).toBeLessThanOrEqual(1);
      } finally {
        shard.stopHeartbeat();
      }
    });
  });

  test('onResumeDispatch runs when shard emits resumed', () => {
    jest.isolateModules(() => {
      const onResumeDispatch = jest.fn();
      const { setupGateway } = require('@/gateway') as typeof import('@/gateway');
      const { WebSocketShard } = require('@fluxerjs/ws') as typeof import('@fluxerjs/ws');

      setupGateway({
        resumeConfirmTimeoutMs: 10_000,
        restoreSession: () => ({ sessionId: 'sess', seq: 1 }),
        clearRestoredSession: () => {},
        onResumeDispatch,
      });

      const shard = makeResumeShard();

      const handleHello = (WebSocketShard.prototype as any).handleHello as (data: {
        heartbeat_interval: number;
      }) => void;

      try {
        handleHello.call(shard, { heartbeat_interval: 41_250 });
        shard.emit('resumed');

        expect(onResumeDispatch).toHaveBeenCalledTimes(1);
      } finally {
        shard.stopHeartbeat();
      }
    });
  });
});
