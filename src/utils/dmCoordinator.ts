const pending = new Map<string, { resolve: (granted: boolean) => void; timeout: NodeJS.Timeout }>();

export function isShardManagerWorker(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CCM_SHARD_MANAGER_WORKER === '1';
}

function initListener(): void {
  if (typeof process.send !== 'function') return;
  process.on('message', (msg: string | number | boolean | object | null) => {
    if (!(msg && typeof msg === 'object' && 'type' in msg && msg.type === 'dmProcessResponse')) return;
    if ('messageId' in msg && typeof msg.messageId === 'string') {
      const p = pending.get(msg.messageId);
      if (p) {
        clearTimeout(p.timeout);
        pending.delete(msg.messageId);
        p.resolve('granted' in msg && !!msg.granted);
      }
    }
  });
}

let inited = false;

export async function requestDMProcess(messageId: string): Promise<boolean> {
  if (!isShardManagerWorker() || typeof process.send !== 'function') return true;

  if (!inited) {
    inited = true;
    initListener();
  }

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      if (pending.delete(messageId)) resolve(false);
    }, 3000);

    pending.set(messageId, { resolve, timeout });
    try {
      process.send!({ type: 'requestDMProcess', messageId });
    } catch {
      pending.delete(messageId);
      clearTimeout(timeout);
      resolve(false);
    }
  });
}
