import config from '@/config';

/** Tell the bot process to drop/reload guild settings (split web+bot deploys). */
export async function notifyBotSettingsInvalidated(guildId: string): Promise<void> {
  if (!/^\d{17,20}$/.test(guildId)) return;

  const token = config.api.adminToken;
  if (!token) return;

  const base = config.bot.internalUrl.replace(/\/$/, '');
  try {
    await fetch(`${base}/internal/invalidate-settings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ guildId }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Bot may be offline; cache TTL will eventually recover.
  }
}
