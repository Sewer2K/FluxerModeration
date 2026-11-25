import { WebSocketShard } from '@fluxerjs/ws';

let patched = false;

export function applyShardPatches(): void {
  if (patched) return;
  patched = true;

  // `any` used for prototype here as the whole thing is filled with private-access fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = WebSocketShard.prototype as any;

  const origEmit = proto.emit;
  proto.emit = function (event: string, ...args: unknown[]) {
    if (event === 'dispatch') {
      setImmediate(() => origEmit.call(this, event, ...args));
      return true;
    }
    return origEmit.call(this, event, ...args);
  };

  // Apply the fast-heartbeat ack grace window while preserving the SDK's
  // heartbeat timestamp and ping accounting.
  const origSendHeartbeat = proto.sendHeartbeat;
  if (typeof origSendHeartbeat === 'function') {
    proto.sendHeartbeat = function () {
      if (!this.lastHeartbeatAck && this.seq !== null) {
        const graceUntil = this.__ccmFastHeartbeatUntil as number | undefined;
        if (graceUntil && Date.now() < graceUntil) {
          this.lastHeartbeatAck = true;
          origSendHeartbeat.call(this);
          return;
        }
      }
      origSendHeartbeat.call(this);
    };
  }

  const origConnect = proto.connect;
  if (typeof origConnect === 'function' && origConnect.length < 1) {
    proto.connect = function (force = false) {
      const state = this.ws?.readyState;
      if (state === 1) return;
      if (!force && state === 0) return;

      if (this.ws) {
        try {
          this.ws.close(1000);
        } catch {}
        this.ws = null;
        this.stopHeartbeat?.();
      }

      this.destroying = false;
      return origConnect.call(this);
    };
  }
}
