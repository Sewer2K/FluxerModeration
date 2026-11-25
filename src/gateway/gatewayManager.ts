import { GatewayOpcodes, GatewaySendPayload } from '@fluxerjs/types';
import { WebSocketShard } from '@fluxerjs/ws';

export interface GatewayConfig {
  ignoredEvents?: string[];
  formatToken?: (token: string) => string;
  omitIntentsOnIdentify?: boolean;
  omitPresenceOnIdentify?: boolean;
  restoreSession?: (shardId: number, shardCount: number) => { sessionId: string; seq: number } | null;
  clearRestoredSession?: (shardId: number, shardCount: number) => void;
  resumeConfirmTimeoutMs?: number;
  fastHeartbeatMs?: number;
  fastHeartbeatDurationMs?: number;
  onFastHeartbeatTick?: (shardId: number, count: number, seq: number | null) => void;
  onFastHeartbeatDone?: (shardId: number, count: number, seq: number | null) => void;
  isShuttingDown?: () => boolean;
  onIdentify?: (shardId: number, ignoredEvents: string[]) => void;
  onSessionRestored?: (shardId: number, sessionId: string, seq: number) => void;
  onResume?: (shardId: number, sessionId: string, seq: number) => void;
  onResumeDispatch?: (shardId: number) => void;
  onResumeTimeout?: (shardId: number) => void;
}

let patched = false;

export function initGateway(config: GatewayConfig): void {
  if (patched) return;
  patched = true;

  // `any` used for prototype here as the whole thing is filled with private-access fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = WebSocketShard.prototype as any;

  const origHello = proto.handleHello;
  proto.handleHello = function (data: unknown) {
    const shardId = typeof this.id === 'number' ? this.id : 0;
    const shardCount = Number(this.options?.numShards) || 1;
    if (typeof this.__ccmFastHeartbeatCleanup === 'function') {
      this.__ccmFastHeartbeatCleanup();
    }
    if (!this.sessionId || this.seq === null) {
      const saved = config.restoreSession?.(shardId, shardCount);
      if (saved) {
        this.sessionId = saved.sessionId;
        this.seq = saved.seq;
        config.onSessionRestored?.(shardId, saved.sessionId, saved.seq);
      }
    }
    config.clearRestoredSession?.(shardId, shardCount);

    const willResume = !!(this.sessionId && this.seq !== null);
    const origSend = this.send.bind(this);

    this.send = (payload: GatewaySendPayload) => {
      if (payload?.op === GatewayOpcodes.Identify && payload.d) {
        if (config.ignoredEvents) {
          // key does not appear to be supported by FluxerJS
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload.d as any).ignored_events = config.ignoredEvents;
        }
        if (config.omitIntentsOnIdentify) {
          // key does not appear to be supported by FluxerJS
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (payload.d as any).intents;
        }
        if (config.omitPresenceOnIdentify) {
          delete payload.d.presence;
        }
        if (config.formatToken && payload.d.token) {
          payload.d.token = config.formatToken(payload.d.token);
        }
        config.onIdentify?.(shardId, config.ignoredEvents ?? []);
      }
      if (payload?.op === GatewayOpcodes.Resume && payload.d?.token) {
        if (config.formatToken) {
          payload.d.token = config.formatToken(payload.d.token);
        }
        config.onResume?.(shardId, payload.d.session_id, payload.d.seq);
      }
      origSend(payload);
    };

    origHello.call(this, data);
    this.send = origSend;

    if (config.fastHeartbeatMs && config.fastHeartbeatDurationMs) {
      this.__ccmFastHeartbeatUntil = Date.now() + config.fastHeartbeatDurationMs + 15_000;
      const socket = this.ws;
      let hbCount = 0;
      const sendHb = () => {
        if (socket?.readyState === 1 && this.ws === socket) {
          this.lastHeartbeatSentAt = Date.now();
          this.send({ op: GatewayOpcodes.Heartbeat, d: this.seq ?? null });
          if (++hbCount % 20 === 0) {
            config.onFastHeartbeatTick?.(shardId, hbCount, this.seq ?? null);
          }
        }
      };
      const heartbeatTimers: {
        start?: ReturnType<typeof setTimeout>;
        interval?: ReturnType<typeof setInterval>;
        done?: ReturnType<typeof setTimeout>;
      } = {};
      const cleanup = () => {
        if (heartbeatTimers.start) clearTimeout(heartbeatTimers.start);
        if (heartbeatTimers.interval) clearInterval(heartbeatTimers.interval);
        if (heartbeatTimers.done) clearTimeout(heartbeatTimers.done);
        this.off('ready', cleanup);
        this.off('resumed', cleanup);
        if (this.__ccmFastHeartbeatCleanup === cleanup) {
          this.__ccmFastHeartbeatCleanup = undefined;
        }
      };
      this.__ccmFastHeartbeatCleanup = cleanup;
      this.once('ready', cleanup);
      this.once('resumed', cleanup);
      heartbeatTimers.start = setTimeout(sendHb, 250);
      heartbeatTimers.interval = setInterval(sendHb, config.fastHeartbeatMs);
      heartbeatTimers.done = setTimeout(() => {
        cleanup();
        config.onFastHeartbeatDone?.(shardId, hbCount, this.seq ?? null);
      }, config.fastHeartbeatDurationMs);
    }

    if (willResume && config.resumeConfirmTimeoutMs) {
      if (typeof this.__ccmResumeCleanup === 'function') {
        this.__ccmResumeCleanup();
      }

      const resumeTimeout = setTimeout(() => {
        if (config.isShuttingDown?.()) return;
        if (!this.sessionId) return;
        config.onResumeTimeout?.(shardId);
        this.sessionId = null;
        this.seq = null;
        const ws = this.ws;
        this.ws = null;
        this.stopHeartbeat?.();
        if (ws?.readyState === 1) {
          try {
            ws.close(1000);
          } catch {}
        }
        if (this.phase !== 3) {
          this.connect?.();
        }
      }, config.resumeConfirmTimeoutMs);

      const cleanup = () => {
        clearTimeout(resumeTimeout);
        this.off('dispatch', onDispatch);
        this.off('ready', onReady);
        this.off('resumed', onResumed);
        if (this.__ccmResumeCleanup === cleanup) {
          this.__ccmResumeCleanup = undefined;
        }
      };

      const onReady = () => cleanup();
      const onResumed = () => {
        cleanup();
        config.onResumeDispatch?.(shardId);
      };
      const onDispatch = () => {
        cleanup();
        config.onResumeDispatch?.(shardId);
      };

      this.once('ready', onReady);
      this.once('resumed', onResumed);
      this.on('dispatch', onDispatch);
      this.__ccmResumeCleanup = cleanup;
    }
  };
}
