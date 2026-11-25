const IP_BAN_DURATION_MS = 24 * 60 * 60 * 1000;
const IP_BAN_LOG_COOLDOWN_MS = 15 * 60 * 1000;
export const IP_BAN_GATEWAY_RETRY_MS = 30 * 60 * 1000;

let ipBannedUntil = 0;
let lastIpBanLogAt = 0;
let ipBanGlitchtipSent = false;

export function isFluxerIpBanError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string; name?: string };
  const code = String(e.code || '');
  const msg = String(e.message || '');
  if (code === 'GLOBAL_IP_TEMPORARILY_BANNED') return true;
  if (msg.includes('GLOBAL_IP_TEMPORARILY_BANNED')) return true;
  if (msg.includes('temporarily blocked from the Fluxer API')) return true;
  return false;
}

export function isFluxerIpBanMessage(message: string): boolean {
  return (
    message.includes('GLOBAL_IP_TEMPORARILY_BANNED') || message.includes('temporarily blocked from the Fluxer API')
  );
}

export function markFluxerIpBan(_error?: unknown): number {
  ipBannedUntil = Date.now() + IP_BAN_DURATION_MS;
  return ipBannedUntil;
}

export function isFluxerIpBanned(): boolean {
  return Date.now() < ipBannedUntil;
}

export function clearFluxerIpBanState(): void {
  ipBannedUntil = 0;
  lastIpBanLogAt = 0;
  ipBanGlitchtipSent = false;
}

export function shouldLogFluxerIpBan(): boolean {
  const now = Date.now();
  if (now - lastIpBanLogAt < IP_BAN_LOG_COOLDOWN_MS) return false;
  lastIpBanLogAt = now;
  return true;
}

export function shouldReportFluxerIpBanToGlitchtip(): boolean {
  if (ipBanGlitchtipSent) return false;
  ipBanGlitchtipSent = true;
  return true;
}

export function noteFluxerApiRecovered(): void {
  if (ipBannedUntil) clearFluxerIpBanState();
}
