import { fluxerApiBaseUrl, fluxerClientId, fluxerWebBaseUrl } from './instance';

const DEFAULT_FLUXER_APP = 'https://fluxer.app';
const BOT_PERMISSIONS = '4504699474930806';

function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export { fluxerApiBaseUrl, fluxerWebBaseUrl };

export function fluxerWebUrl(pathname: string): string {
  return `${fluxerWebBaseUrl()}/${pathname.replace(/^\/+/, '')}`;
}

export function fluxerMessageUrl(guildId: string, channelId: string, messageId: string): string {
  const baseUrl = trimBaseUrl(fluxerWebBaseUrl() || DEFAULT_FLUXER_APP);
  return `${baseUrl}/channels/${guildId}/${channelId}/${messageId}`;
}

export function fluxerBotInviteUrl(guildId?: string): string {
  const params = new URLSearchParams({
    client_id: fluxerClientId(),
    scope: 'bot',
    permissions: BOT_PERMISSIONS,
  });
  if (guildId) params.set('guild_id', guildId);
  return `${fluxerWebUrl('/oauth2/authorize')}?${params.toString()}`;
}
