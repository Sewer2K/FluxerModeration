import type { Client, EmbedBuilder, MessageReaction, User } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';
import type { GatewayReactionEmoji, RESTPostAPIEmbed } from '@fluxerjs/types';
import { encodeReactionForRoute } from './encodeReactionForRoute';
import { isArray } from './isArray';
import { messageFromError } from './messageFromError';

const PREV_EMOJI = '◀';
const NEXT_EMOJI = '▶';
const DEFAULT_TTL_MS = 3 * 60 * 1000;

interface PaginatorSession {
  messageId: string;
  channelId: string;
  ownerUserId: string;
  pageIndex: number;
  pages: (RESTPostAPIEmbed | EmbedBuilder)[];
  expiresAt: number;
  timeout: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, PaginatorSession>();

function normalizeEmoji(emoji: GatewayReactionEmoji): string {
  if (emoji?.id) return `${emoji.name}:${emoji.id}`;
  return String(emoji?.name ?? '')
    .replace(/[\uFE00-\uFE0F\u200D]/g, '')
    .trim();
}

function isPrevEmoji(emoji: GatewayReactionEmoji): boolean {
  const v = normalizeEmoji(emoji);
  return v === '⬅' || v === '◀';
}

function isNextEmoji(emoji: GatewayReactionEmoji): boolean {
  const v = normalizeEmoji(emoji);
  return v === '➡' || v === '▶';
}

function toEmbedJson(embed: RESTPostAPIEmbed | EmbedBuilder) {
  if ('toJSON' in embed && typeof embed.toJSON === 'function') {
    return embed.toJSON();
  }
  return embed;
}

function reactionRouteParam(emoji: GatewayReactionEmoji): string {
  if (emoji?.id) {
    return encodeURIComponent(`${emoji.name}:${emoji.id}`);
  }
  return encodeReactionForRoute(String(emoji?.name ?? ''));
}

async function removeUserReaction(client: Client, reaction: MessageReaction, userId: string): Promise<void> {
  const channelId = String(reaction.channelId ?? '');
  const messageId = String(reaction.messageId ?? '');
  if (!channelId || !messageId) return;

  const encoded = reactionRouteParam(reaction.emoji);
  if (!encoded) return;

  await client.rest.delete(`${Routes.channelMessageReaction(channelId, messageId, encoded)}/${userId}`).catch(() => {});
}

async function removePaginatorReactions(client: Client, session: PaginatorSession): Promise<void> {
  await client.rest.delete(Routes.channelMessageReactions(session.channelId, session.messageId)).catch(async () => {
    const prev = encodeReactionForRoute(PREV_EMOJI);
    const next = encodeReactionForRoute(NEXT_EMOJI);
    await client.rest
      .delete(`${Routes.channelMessageReaction(session.channelId, session.messageId, prev)}/@me`)
      .catch(() => {});
    await client.rest
      .delete(`${Routes.channelMessageReaction(session.channelId, session.messageId, next)}/@me`)
      .catch(() => {});
  });
}

async function clearSession(client: Client, messageId: string, removeReactions: boolean): Promise<void> {
  const existing = sessions.get(messageId);
  if (!existing) return;

  clearTimeout(existing.timeout);
  sessions.delete(messageId);

  if (removeReactions) {
    await removePaginatorReactions(client, existing);
  }
}

async function renderPage(client: Client, session: PaginatorSession): Promise<void> {
  const page = session.pages[session.pageIndex];
  if (!page) return;

  const embed = toEmbedJson(page);
  await client.rest.patch(Routes.channelMessage(session.channelId, session.messageId), {
    body: { embeds: [embed] },
  });
}

async function addBotReaction(
  client: Client,
  channelId: string,
  messageId: string,
  emoji: string,
  targetMessage?: { react: (value: string) => Promise<void> },
): Promise<void> {
  try {
    if (targetMessage?.react) {
      await targetMessage.react(emoji);
      return;
    }
    const encoded = encodeReactionForRoute(emoji);
    await client.rest.put(`${Routes.channelMessageReaction(channelId, messageId, encoded)}/@me`);
  } catch (err: unknown) {
    console.warn(`[paginator] failed to add ${emoji} reaction: ${messageFromError(err)}`);
  }
}

export async function registerReactionPaginator(
  client: Client,
  opts: {
    messageId: string;
    channelId: string;
    ownerUserId: string;
    pages: (RESTPostAPIEmbed | EmbedBuilder)[];
    initialPageIndex?: number;
    ttlMs?: number;
    targetMessage?: { react: (value: string) => Promise<void> };
  },
): Promise<void> {
  if (!opts.messageId || !opts.channelId || !opts.ownerUserId) return;
  if (!isArray(opts.pages) || opts.pages.length <= 1) return;

  await clearSession(client, opts.messageId, false);

  const ttlMs = Math.max(30_000, opts.ttlMs ?? DEFAULT_TTL_MS);
  const maxIndex = opts.pages.length - 1;
  const pageIndex = Math.min(maxIndex, Math.max(0, opts.initialPageIndex ?? 0));

  const session: PaginatorSession = {
    messageId: opts.messageId,
    channelId: opts.channelId,
    ownerUserId: opts.ownerUserId,
    pageIndex,
    pages: opts.pages,
    expiresAt: Date.now() + ttlMs,
    timeout: setTimeout(() => {
      void clearSession(client, opts.messageId, true);
    }, ttlMs),
  };

  session.timeout.unref();
  sessions.set(opts.messageId, session);

  await addBotReaction(client, opts.channelId, opts.messageId, PREV_EMOJI, opts.targetMessage);
  await addBotReaction(client, opts.channelId, opts.messageId, NEXT_EMOJI, opts.targetMessage);
}

export async function handlePaginatorReaction(client: Client, reaction: MessageReaction, user: User): Promise<boolean> {
  const messageId = String(reaction?.messageId ?? '');
  if (!messageId) return false;

  const session = sessions.get(messageId);
  if (!session) return false;

  const channelId = String(reaction?.channelId ?? '');
  if (!channelId || channelId !== session.channelId) return false;

  const prev = isPrevEmoji(reaction?.emoji);
  const next = isNextEmoji(reaction?.emoji);
  if (!prev && !next) return false;

  if (user?.id) {
    await removeUserReaction(client, reaction, String(user.id));
  }

  if (Date.now() >= session.expiresAt) {
    await clearSession(client, messageId, true);
    return true;
  }

  if (!user || user.bot) return true;
  if (String(user.id) !== session.ownerUserId) return true;

  const oldIndex = session.pageIndex;
  if (next && session.pageIndex < session.pages.length - 1) {
    session.pageIndex += 1;
  }
  if (prev && session.pageIndex > 0) {
    session.pageIndex -= 1;
  }

  if (session.pageIndex !== oldIndex) {
    await renderPage(client, session).catch(async () => {
      await clearSession(client, messageId, false);
    });
  }

  return true;
}
