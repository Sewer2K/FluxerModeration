import { useEffect, useState } from 'react';
import { api, type PublicStatus } from '../lib/api';

const POLL_MS = 30_000;

const OFFLINE_STATUS: PublicStatus = {
  status: 'degraded',
  online: false,
  gateway: 'disconnected',
  wsPing: null,
  readyAt: null,
  uptime: 0,
  guilds: 0,
  timestamp: Date.now(),
  dashboard: 'online',
  botProcess: 'offline',
};

export function useBotStatus() {
  const [status, setStatus] = useState<PublicStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await api.get<PublicStatus>('/public/status', { skipCache: true });
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus(OFFLINE_STATUS);
      }
    };

    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return status;
}
