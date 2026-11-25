import type { Command } from '@/types';
import { logModAction } from '@/utils/logger';
import isNetworkError from '@/utils/isNetworkError';
import { isPermDenied, permMessage } from '@/utils/permError';
import settingsCache from '@/utils/settingsCache';
import {
  deleteChannelMessageIds,
  fetchRecentChannelMessageIds,
  MAX_CLEAR_AMOUNT,
} from '@/utils/channelMessageBulkDelete';
import { t, normalizeLocale } from '@/i18n';
import { isGuildTextChannel } from '@/utils/isGuildTextChannel';
import { messageFromError } from '@/utils/messageFromError';
import ModerationLog from '@/models/ModerationLog';

const command: Command = {
  name: 'clear',
  description:
    'Bulk delete messages in the current channel \u2014 the command message is included in the count. Up to 1000 messages per run',
  usage: '<amount 1\u20131000>',
  category: 'moderation',
  permissions: ['ManageMessages'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = message.guild;
    if (!guild && message.guildId) {
      guild = await client.guilds.fetch(message.guildId);
    }

    if (!guild) {
      return void (await message.reply(t('en', 'commands.generic.serverOnly')));
    }

    const guildSettings = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    if (!args[0]) {
      return void (await message.reply(t(lang, 'commands.moderation.clear.usage', { prefix })));
    }

    const amount = parseInt(args[0], 10);

    if (isNaN(amount)) {
      return void (await message.reply(t(lang, 'commands.moderation.clear.invalidNumber')));
    }

    if (amount < 1 || amount > MAX_CLEAR_AMOUNT) {
      return void (await message.reply(t(lang, 'commands.moderation.clear.amountRange')));
    }

    const channelId = message.channelId || message.channel?.id;
    if (!channelId) {
      return void (await message.reply(t(lang, 'commands.moderation.clear.errors.generic')));
    }

    const channel =
      message.channel ?? guild.channels?.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
    if (!channel) {
      return void (await message.reply(t(lang, 'commands.moderation.clear.errors.generic')));
    }

    const moderator = message.author;
    const channelName = channel.name ?? channelId;
    const guildName = guild?.name || 'Unknown Server';

    try {
      const messageIds = await fetchRecentChannelMessageIds(client.rest, channelId, amount);

      if (messageIds.length === 0) {
        return void (await message.reply(t(lang, 'commands.moderation.clear.noMessages')));
      }

      const deletedCount = await deleteChannelMessageIds(client.rest, channel, channelId, messageIds, (error, id) => {
        console.warn(`[${guildName}] Failed to delete message ${id}: ${(error as Error)?.message || error}`);
      });

      if (deletedCount === 0) {
        return void (await message.reply(t(lang, 'commands.moderation.clear.noMessages')));
      }

      if (isGuildTextChannel(channel)) {
        const confirmMsg = await channel.send(
          t(lang, 'commands.moderation.clear.successDeleted', { userCount: deletedCount }),
        );
        setTimeout(() => {
          confirmMsg.delete().catch(() => {});
        }, 5000);
      } else {
        console.warn(`Non-guild-text channel, ${channel.id}, used for clear command`);
      }

      await logModAction(guild, moderator, null, 'clear', `Deleted ${deletedCount} messages in #${channelName}`, {
        fields: [
          { name: 'Channel', value: `<#${channelId}>`, inline: true },
          { name: 'Messages Deleted', value: `${deletedCount}`, inline: true },
        ],
        client,
      });

      await ModerationLog.logAction({
        guildId: guild.id,
        userId: moderator.id,
        targetId: guild.id,
        action: 'purge',
        reason: `Deleted ${deletedCount} messages in #${channelName}`,
        duration: null,
        metadata: { messageCount: deletedCount, channelId, channelName },
        viaDashboard: false,
      }).catch((err: unknown) => {
        console.error(`[${guildName}] Failed to save purge case: ${messageFromError(err)}`);
      });
    } catch (error) {
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !clear (ECONNRESET)`);
      } else if (error && typeof error === 'object' && 'code' in error && error.code === 50034) {
        message.reply(t(lang, 'commands.moderation.clear.errors.cannotDeleteOlderThan14Days')).catch(() => {});
      } else if (isPermDenied(error)) {
        message.reply(permMessage(lang, 'clear')).catch(() => {});
      } else {
        console.error(`[${guildName}] Error in !clear: ${messageFromError(error)}`);
        message.reply(t(lang, 'commands.moderation.clear.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
