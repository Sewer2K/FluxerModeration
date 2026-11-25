export function reactionEmojiKey(emoji: { id?: string | null; name?: string | null } | null | undefined): string {
  if (!emoji) return '';
  if (emoji.id) return `${emoji.name}:${emoji.id}`;
  return String(emoji.name ?? '')
    .replace(/[\uFE00-\uFE0F\u200D]/g, '')
    .trim();
}

export function normalizeStoredReactionEmoji(stored: string): string {
  const mention = /^<a?:(\w+):(\d+)>$/.exec(stored);
  if (mention) return `${mention[1]}:${mention[2]}`;
  const colon = /^a?:(\w+):(\d+)$/.exec(stored);
  if (colon) return `${colon[1]}:${colon[2]}`;
  return stored.replace(/[\uFE00-\uFE0F\u200D]/g, '').trim();
}

export function reactionRoleEmojiMatches(
  stored: string,
  emoji: { id?: string | null; name?: string | null } | null | undefined,
): boolean {
  const incoming = reactionEmojiKey(emoji);
  const configured = normalizeStoredReactionEmoji(stored);
  return incoming.length > 0 && incoming === configured;
}
