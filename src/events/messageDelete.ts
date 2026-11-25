import type { Channel, Client, Message, PartialMessage } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';
import type { BotEvent } from '@/types';
import automod from '@/automod';
import { logServerEvent } from '@/utils/logger';
import * as messageCache from '@/utils/messageCache';
import { includeMessageLogLinks, messageJumpLinkField } from '@/utils/messageLogLinks';
import { formatMessageLogContent, truncateMessageLogContent } from '@/utils/messageLogContent';
import StarboardMessage from '@/models/StarboardMessage';
import settingsCache from '@/utils/settingsCache';
import { getStarboards } from '@/utils/starboardBoards';
import { isGuildTextChannel } from '@/utils/isGuildTextChannel';
import { messageFromError } from '@/utils/messageFromError';
import activityService from '@/services/ActivityService';

function deletedAuthorMention(message: PartialMessage): string {
  const authorId = message.authorId;
  return authorId ? `<@${authorId}>` : '*(unknown)*';
}

const event: BotEvent = {
  name: 'messageDelete',

  async execute(message: PartialMessage, client: Client) {
    const channelId = message.channelId || message.channel?.id;
    if (!channelId) return;

    let channel: Channel | null = message.channel ?? null;
    if (!channel) {
      try {
        channel = await client.channels.fetch(channelId);
      } catch {
        return;
      }
    }
    if (!channel || !isGuildTextChannel(channel)) return;

    const guildId = channel.guildId;
    if (!guildId) return;

    // ghostPing expects Message-ish fields; cast is fine for optional author/content
    const ghostPingDetected = await automod.handleGhostPing(message as unknown as Message, client);
    if (ghostPingDetected) activityService.recordAutomodAction(guildId);

    const guild = client.guilds.get(guildId);
    if (!guild) return;

    const cachedContent = message.id ? messageCache.get(message.id) : null;
    const rawContent = cachedContent || formatMessageLogContent(message as unknown as Message);
    const content = rawContent ? truncateMessageLogContent(rawContent) : '*(content not cached)*';

    if (message.id) messageCache.remove(message.id);

    const fields: { name: string; value: string; inline?: boolean }[] = [
      { name: 'Author', value: deletedAuthorMention(message), inline: true },
      { name: 'Channel', value: `<#${channelId}>`, inline: true },
      { name: 'Content', value: content },
    ];

    const settings = await settingsCache.get(guildId).catch(() => null);
    if (includeMessageLogLinks(settings) && guildId && channelId && message.id) {
      fields.push(messageJumpLinkField(guildId, channelId, message.id));
    }

    await logServerEvent(
      guild,
      'Message Deleted',
      0x99aab5,
      fields,
      client,
      message.id
        ? { footer: `Message ID: ${message.id}`, eventType: 'message_delete' }
        : { eventType: 'message_delete' },
    );

    // ─── Starboard cleanup ───
    if (message.id) {
      try {
        const boards = getStarboards(settings);
        if (boards.length > 0) {
          const originals = await StarboardMessage.find({ guildId, messageId: message.id });
          if (originals.length > 0) {
            for (const entry of originals) {
              const channelId = entry.starboardChannelId || boards.find((b) => b.channelId)?.channelId;
              if (entry.starboardMessageId && channelId) {
                try {
                  await client.rest.delete(Routes.channelMessage(channelId, entry.starboardMessageId));
                } catch {}
              }
              await StarboardMessage.deleteOne({ _id: entry._id });
            }
          } else {
            const asStarboard = await StarboardMessage.find({ guildId, starboardMessageId: message.id });
            for (const entry of asStarboard) {
              entry.starboardMessageId = null;
              await entry.save();
            }
          }
        }
      } catch (sbErr: unknown) {
        console.error(`[starboard] Error in message delete cleanup: ${messageFromError(sbErr)}`);
      }
    }
  },
};

export default event;
