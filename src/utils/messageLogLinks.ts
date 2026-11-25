import { fluxerAppUrl } from './fluxerUrls';

export function messageJumpUrl(guildId: string, channelId: string, messageId: string): string {
  return fluxerAppUrl(`/channels/${guildId}/${channelId}/${messageId}`);
}

export function includeMessageLogLinks(settings: { messageLogIncludeLinks?: boolean } | null | undefined): boolean {
  return settings?.messageLogIncludeLinks !== false;
}

export function messageJumpLinkField(
  guildId: string,
  channelId: string,
  messageId: string,
): { name: string; value: string; inline: true } {
  const jumpUrl = messageJumpUrl(guildId, channelId, messageId);
  return { name: 'Message Link', value: `[Open message](${jumpUrl})`, inline: true };
}
