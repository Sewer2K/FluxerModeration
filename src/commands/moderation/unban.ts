import type { User } from '@fluxerjs/core';
import type { Command } from '@/types';
import parseUserId from '@/utils/parseUserId';
import { logModAction } from '@/utils/logger';
import ModerationLog from '@/models/ModerationLog';
import isNetworkError from '@/utils/isNetworkError';
import { isPermDenied, permMessage } from '@/utils/permError';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import { isArray } from '@/utils/isArray';
import { messageFromError } from '@/utils/messageFromError';
import BanAppeal from '@/models/BanAppeal';

// Fluxer rejects unban of a user who isn't banned with a 400 INVALID_FORM_BODY
// carrying USER_IS_NOT_BANNED in the field errors
export function isUserNotBannedError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('errors' in error)) return false;
  const errors = (error as { errors?: unknown }).errors;
  if (!isArray(errors)) return false;
  return errors.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const code = 'code' in entry ? entry.code : undefined;
    const message = 'message' in entry ? entry.message : undefined;
    return code === 'USER_IS_NOT_BANNED' || message === 'USER_IS_NOT_BANNED';
  });
}

const command: Command = {
  name: 'unban',
  description:
    'Remove a ban from a previously banned user. Requires their user ID (right-click their name > Copy ID) also in logs',
  usage: '<user ID> [reason]',
  category: 'moderation',
  permissions: ['BanMembers'],
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
      return void (await message.reply(t(lang, 'commands.moderation.unban.usage', { prefix })));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void (await message.reply(t(lang, 'commands.generic.invalidUserInput')));
    }

    const reason = args.slice(1).join(' ').trim() || t(lang, 'commands.generic.noReasonProvided');

    try {
      let targetUser: Pick<User, 'id' | 'username'>;
      try {
        targetUser = await client.users.fetch(userId);
      } catch {
        targetUser = { id: userId, username: t(lang, 'commands.userinfo.unknown') };
      }

      await guild.unban(userId);

      await BanAppeal.updateOne(
        { guildId: guild.id, userId, state: 'pending' },
        {
          $set: {
            state: 'dismissed',
            eligible: false,
            decidedAt: new Date(),
            decidedBy: message.author.id,
            staffReason: 'Manual unban',
            nextEligibleAt: null,
          },
          $push: {
            history: {
              at: new Date(),
              by: message.author.id,
              action: 'unban',
              note: 'Manual unban',
            },
          },
        },
      ).catch((error: unknown) => {
        console.warn(`[${guild.name}] Failed to close pending appeal after manual unban: ${messageFromError(error)}`);
      });

      const displayName = targetUser.username || targetUser.id;
      await message.reply(
        t(lang, 'commands.moderation.unban.success', { username: displayName, userId: targetUser.id, reason }),
      );

      await logModAction(guild, message.author, targetUser, 'unban', reason, { client });

      await ModerationLog.logAction({
        guildId: guild.id,
        targetId: userId,
        userId: message.author.id,
        action: 'unban',
        reason,
      });
    } catch (error) {
      const guildName = guild.name;
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !unban (ECONNRESET)`);
      } else if (isUserNotBannedError(error)) {
        message.reply(t(lang, 'commands.moderation.unban.notBanned')).catch(() => {});
      } else if (isPermDenied(error)) {
        message.reply(permMessage(lang, 'unban')).catch(() => {});
      } else {
        console.error(`[${guildName}] Error in !unban: ${messageFromError(error)}`);
        message.reply(t(lang, 'commands.moderation.unban.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
