export interface BotStatusSnapshot {
  online: boolean;
  gateway: 'connected' | 'disconnected';
  wsPing: number | null;
  readyAt: string | null;
  uptime: number;
  guilds: number;
  pid: number;
  username: string | null;
  userId: string | null;
  avatar: string | null;
  updatedAt: number;
}

export interface PublicStatusPayload {
  status: 'online' | 'degraded';
  online: boolean;
  gateway: string;
  wsPing: number | null;
  readyAt: string | null;
  uptime: number;
  guilds: number;
  timestamp: number;
  dashboard: 'online' | 'offline';
  botProcess: 'online' | 'offline';
}

export function snapshotToPublicStatus(snapshot: BotStatusSnapshot | null): PublicStatusPayload {
  const botOnline = snapshot?.online ?? false;
  const wsPing = snapshot?.wsPing ?? null;
  const gateway = wsPing === null || wsPing === undefined ? (botOnline ? 'connected' : 'disconnected') : 'connected';

  return {
    status: botOnline ? 'online' : 'degraded',
    online: botOnline,
    gateway,
    wsPing,
    readyAt: snapshot?.readyAt ?? null,
    uptime: snapshot?.uptime ?? 0,
    guilds: snapshot?.guilds ?? 0,
    timestamp: Date.now(),
    dashboard: 'online',
    botProcess: snapshot ? 'online' : 'offline',
  };
}
