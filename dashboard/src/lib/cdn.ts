let mediaBase = 'https://fluxerusercontent.com';

function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function setFluxerMediaBase(url: string): void {
  if (url) mediaBase = trimBaseUrl(url);
}

export function fluxerMediaBase(): string {
  return mediaBase;
}

function stillAssetUrl(path: string, size: number): string {
  return `${mediaBase}/${path}?animated=false&size=${size}`;
}

export function fluxerIconUrl(guildId: string, icon: string | null, size = 64): string | null {
  if (!icon) return null;
  return stillAssetUrl(`icons/${guildId}/${icon}.webp`, size);
}

export function fluxerAvatarUrl(userId: string, avatar: string | null, size = 64): string | null {
  if (!avatar) return null;
  return stillAssetUrl(`avatars/${userId}/${avatar}.webp`, size);
}

export function fluxerEmojiUrl(emojiId: string, animated: boolean, size = 32): string {
  return `${mediaBase}/emojis/${emojiId}.webp?animated=${animated ? 'true' : 'false'}&size=${size}&quality=lossless`;
}
