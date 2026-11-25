import type { Channel, Client } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';
import { buildEmbedBuilder, type EmbedPayload } from './embedPayload';
import { isTextChannel } from './isTextChannel';

export async function sendGuildEmbedViaBot(
  client: Client,
  channelId: string,
  embed: EmbedPayload,
  content?: string | null,
): Promise<void> {
  let channel: Channel | null = client.channels.get(channelId) ?? null;
  if (!channel) {
    channel = await client.channels.fetch(channelId);
  }
  if (!channel || !isTextChannel(channel)) {
    throw new Error('Channel not found or not messageable');
  }

  const built = buildEmbedBuilder(embed);
  await channel.send({
    content: content?.trim() || undefined,
    embeds: [built],
  });
}

export async function sendGuildEmbedViaWebhook(
  client: Client,
  webhookId: string,
  webhookToken: string,
  embed: EmbedPayload,
  options: { content?: string | null; username?: string | null } = {},
): Promise<void> {
  const rest = client?.rest;
  if (!rest || typeof rest.post !== 'function') {
    throw new Error('Fluxer REST client unavailable');
  }

  const built = buildEmbedBuilder(embed);
  await rest.post(Routes.webhookExecute(webhookId, webhookToken), {
    auth: false,
    body: {
      content: options.content?.trim() || undefined,
      username: options.username?.trim() || undefined,
      embeds: [built],
    },
  });
}
