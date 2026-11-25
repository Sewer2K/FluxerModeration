import { EmbedBuilder } from '@fluxerjs/core';
import { isArray } from './isArray';

export const EMBED_MAX_FIELDS = 25;

export interface EmbedFieldPayload {
  name: string;
  value: string;
  inline?: boolean;
}

export interface EmbedPayload {
  title?: string | null;
  description?: string | null;
  color?: string | number | null;
  url?: string | null;
  footer?: string | null;
  thumbnail?: string | null;
  image?: string | null;
  fields?: EmbedFieldPayload[];
}

const HEX_COLOR_RE = /^#?[0-9a-fA-F]{6}$/;
const FLUXER_WEBHOOK_URL_RE = /^https?:\/\/[^/]+\/webhooks\/(\d{17,20})\/([A-Za-z0-9_-]+)/i;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseEmbedColor(color: unknown): number | null {
  if (color === null || color === undefined || color === '') return null;
  if (typeof color === 'number' && Number.isInteger(color) && color >= 0 && color <= 0xffffff) {
    return color;
  }
  if (typeof color === 'string') {
    const trimmed = color.trim();
    if (!trimmed) return null;
    if (HEX_COLOR_RE.test(trimmed)) {
      return Number.parseInt(trimmed.replace('#', ''), 16);
    }
  }
  return null;
}

export function validateEmbedPayload(raw: unknown): { ok: true; payload: EmbedPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || isArray(raw)) {
    return { ok: false, error: 'Embed must be an object' };
  }

  const input = raw as Record<string, unknown>;
  const payload: EmbedPayload = {};

  if (input.title !== undefined && input.title !== null) {
    if (typeof input.title !== 'string' || input.title.length > 256) {
      return { ok: false, error: 'Title must be a string up to 256 characters' };
    }
    payload.title = input.title.trim() || null;
  }

  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== 'string' || input.description.length > 4096) {
      return { ok: false, error: 'Description must be a string up to 4096 characters' };
    }
    payload.description = input.description.trim() || null;
  }

  if (input.footer !== undefined && input.footer !== null) {
    if (typeof input.footer !== 'string' || input.footer.length > 2048) {
      return { ok: false, error: 'Footer must be a string up to 2048 characters' };
    }
    payload.footer = input.footer.trim() || null;
  }

  if (input.url !== undefined && input.url !== null) {
    if (typeof input.url !== 'string' || !isHttpUrl(input.url.trim())) {
      return { ok: false, error: 'URL must be a valid http(s) link' };
    }
    payload.url = input.url.trim();
  }

  for (const key of ['thumbnail', 'image'] as const) {
    if (input[key] === undefined || input[key] === null) continue;
    if (typeof input[key] !== 'string' || !isHttpUrl((input[key] as string).trim())) {
      return { ok: false, error: `${key} must be a valid http(s) URL` };
    }
    payload[key] = (input[key] as string).trim();
  }

  if (input.color !== undefined && input.color !== null && input.color !== '') {
    const parsed = parseEmbedColor(input.color);
    if (parsed === null) return { ok: false, error: 'Color must be a 6-digit hex value' };
    payload.color = parsed;
  }

  if (input.fields !== undefined) {
    if (!isArray(input.fields)) return { ok: false, error: 'Fields must be an array' };
    if (input.fields.length > EMBED_MAX_FIELDS) {
      return { ok: false, error: `Fields can contain at most ${EMBED_MAX_FIELDS} items` };
    }

    const fields: EmbedFieldPayload[] = [];
    for (const field of input.fields) {
      if (!field || typeof field !== 'object' || isArray(field)) {
        return { ok: false, error: 'Each field must be an object' };
      }
      const entry = field as Record<string, unknown>;
      if (typeof entry.name !== 'string' || entry.name.trim().length === 0 || entry.name.length > 256) {
        return { ok: false, error: 'Field names must be 1-256 characters' };
      }
      if (typeof entry.value !== 'string' || entry.value.length > 1024) {
        return { ok: false, error: 'Field values must be strings up to 1024 characters' };
      }
      fields.push({
        name: entry.name.trim(),
        value: entry.value,
        inline: entry.inline === true,
      });
    }
    payload.fields = fields;
  }

  const hasBody =
    Boolean(payload.title) || Boolean(payload.description) || Boolean(payload.fields && payload.fields.length > 0);
  if (!hasBody) {
    return { ok: false, error: 'Embed needs a title, description, or at least one field' };
  }

  return { ok: true, payload };
}

export function buildEmbedBuilder(payload: EmbedPayload): EmbedBuilder {
  const embed = new EmbedBuilder();
  if (payload.title) embed.setTitle(payload.title);
  if (payload.description) embed.setDescription(payload.description);
  if (payload.url) embed.setURL(payload.url);
  const color = parseEmbedColor(payload.color);
  if (color !== null) embed.setColor(color);
  if (payload.thumbnail) embed.setThumbnail(payload.thumbnail);
  if (payload.image) embed.setImage(payload.image);
  if (payload.footer) embed.setFooter({ text: payload.footer });
  if (payload.fields?.length) {
    for (const field of payload.fields) {
      embed.addFields({ name: field.name, value: field.value, inline: field.inline ?? false });
    }
  }
  return embed;
}

export function parseWebhookTarget(input: {
  webhookUrl?: string | null;
  webhookId?: string | null;
  webhookToken?: string | null;
}): { id: string; token: string } | null {
  if (input.webhookUrl && typeof input.webhookUrl === 'string') {
    const trimmed = input.webhookUrl.trim();
    const fluxerMatch = trimmed.match(FLUXER_WEBHOOK_URL_RE);
    if (fluxerMatch && '1' in fluxerMatch && '2' in fluxerMatch) return { id: fluxerMatch[1], token: fluxerMatch[2] };
  }

  if (
    typeof input.webhookId === 'string' &&
    /^\d{17,20}$/.test(input.webhookId) &&
    typeof input.webhookToken === 'string' &&
    input.webhookToken.trim().length > 0
  ) {
    return { id: input.webhookId, token: input.webhookToken.trim() };
  }

  return null;
}
