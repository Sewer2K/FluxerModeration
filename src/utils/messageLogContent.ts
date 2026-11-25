import * as messageCache from './messageCache';
import { isArray } from './isArray';
import type { Message } from '@fluxerjs/core';

type MessageLogEmbed = {
  title?: string | null;
  description?: string | null;
  fields?: unknown;
  footer?: unknown;
  image?: unknown;
  thumbnail?: unknown;
};

function embedToText(embed: MessageLogEmbed): string | null {
  const parts: string[] = [];

  const { title, description, fields, footer, image, thumbnail } = embed;

  if (typeof title === 'string' && title.trim()) parts.push(`**${title.trim()}**`);

  if (typeof description === 'string' && description.trim()) parts.push(description.trim());

  if (isArray(fields)) {
    for (const field of fields) {
      if (!field || typeof field !== 'object') continue;
      const fieldRecord = field as { name?: unknown; value?: unknown };
      const name = typeof fieldRecord.name === 'string' ? fieldRecord.name.trim() : '';
      const value = typeof fieldRecord.value === 'string' ? fieldRecord.value.trim() : '';
      if (name && value) parts.push(`**${name}:** ${value}`);
      else if (value) parts.push(value);
      else if (name) parts.push(`**${name}**`);
    }
  }

  const footerText =
    typeof footer === 'string'
      ? footer
      : footer && typeof footer === 'object'
        ? (footer as { text?: string }).text
        : '';
  if (footerText?.trim()) parts.push(`_${footerText.trim()}_`);

  const imageUrl =
    typeof image === 'string' ? image : image && typeof image === 'object' ? (image as { url?: string }).url : '';
  if (imageUrl) parts.push(imageUrl);

  const thumbUrl =
    typeof thumbnail === 'string'
      ? thumbnail
      : thumbnail && typeof thumbnail === 'object'
        ? (thumbnail as { url?: string }).url
        : '';
  if (thumbUrl && thumbUrl !== imageUrl) parts.push(thumbUrl);

  if (parts.length === 0) return null;
  return parts.join('\n');
}

function listAttachments(message: Message) {
  const attachments = message.attachments;
  if (!attachments) return [];
  if (typeof attachments.values === 'function') return [...attachments.values()];
  return [];
}

function listEmbeds(message: Message) {
  const { embeds } = message;
  if (!embeds) return [];
  if (isArray(embeds)) return embeds;
  return [];
}

export function formatMessageLogContent(message: Message | null | undefined): string | null {
  if (!message) return null;

  const chunks: string[] = [];
  const content = typeof message.content === 'string' ? message.content.trim() : '';
  if (content) chunks.push(content);

  const embeds = listEmbeds(message);
  embeds.forEach((embed, index) => {
    const text = embedToText(embed);
    if (!text) return;
    chunks.push(embeds.length > 1 ? `[Embed ${index + 1}]\n${text}` : text);
  });

  for (const att of listAttachments(message)) {
    const name = att.filename;
    const url = att.url ?? att.proxyUrl ?? '';
    chunks.push(url ? `[${name}](${url})` : name);
  }

  if (chunks.length === 0) return null;
  return chunks.join('\n\n');
}

export function truncateMessageLogContent(content: string, max = 1024): string {
  return content.length > max ? content.substring(0, max - 3) + '...' : content;
}

export function cacheMessageForDeleteLog(message: Message): void {
  const text = formatMessageLogContent(message);
  if (!text) return;

  messageCache.store(message.id, text);
}
