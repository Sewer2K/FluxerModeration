import type { Command } from '@/types';
import parseUserId from '@/utils/parseUserId';
import { logModAction } from '@/utils/logger';
import settingsCache from '@/utils/settingsCache';
import ModerationLog from '@/models/ModerationLog';
import isNetworkError from '@/utils/isNetworkError';
import { isPermDenied, permMessage } from '@/utils/permError';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'unmute',
  description: 'Remove a Fluxer timeout from a member so they can send messages and join voice again',
  usage: '<@user or user ID>',
  category: 'moderation',
  permissions: ['ModerateMembers'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = message.guild;
    if (!guild && message.guildId) {
      guild = await client.guilds.fetch(message.guildId);
    }

    if (!guild) {
      return void (await message.reply(t('en', 'commands.generic.serverOnly')));
    }

    const settings = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(settings?.language);

    if (!args[0]) {
      return void (await message.reply(t(lang, 'commands.moderation.unmute.usage', { prefix })));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void (await message.reply(t(lang, 'commands.generic.invalidUserInput')));
    }

    let targetMember = guild.members?.get(userId);
    if (!targetMember) {
      try {
        targetMember = await guild.fetchMember(userId);
      } catch {
        return void (await message.reply(t(lang, 'commands.generic.userNotInServer')));
      }
    }

    if (!targetMember) {
      return void (await message.reply(t(lang, 'commands.generic.userNotInServer')));
    }
    const muteRoleId = settings?.moderation?.muteRoleId || settings?.muteRoleId;
    const muteMethod: 'auto' | 'timeout' | 'mute_role' = settings?.moderation?.muteMethod || 'auto';

    const isTimeoutMuted =
      targetMember.communicationDisabledUntil && targetMember.communicationDisabledUntil > new Date();
    const memberRoleIds: readonly string[] = targetMember.roles?.roleIds ?? [];
    const isRoleMuted = !!(muteRoleId && memberRoleIds.includes(muteRoleId));

    const unmuteByTimeout = muteMethod === 'timeout' || muteMethod === 'auto';
    const unmuteByRole = muteMethod === 'mute_role' || muteMethod === 'auto';

    if ((!unmuteByTimeout || !isTimeoutMuted) && (!unmuteByRole || !isRoleMuted)) {
      return void (await message.reply(t(lang, 'commands.moderation.unmute.notCurrentlyMuted')));
    }

    try {
      if (unmuteByRole && isRoleMuted && muteRoleId) {
        await targetMember.roles.remove(muteRoleId);
      }

      if (unmuteByTimeout && isTimeoutMuted) {
        await targetMember.edit({
          communicationDisabledUntil: null,
        });
      }

      const displayName = targetMember.user?.username || targetMember.id;
      await message.reply(
        t(lang, 'commands.moderation.unmute.success', { username: displayName, userId: targetMember.id }),
      );

      await logModAction(guild, message.author, targetMember.user || targetMember, 'unmute', 'Timeout removed', {
        client,
      });

      await ModerationLog.logAction({
        guildId: guild.id,
        targetId: targetMember.id,
        userId: message.author.id,
        action: 'unmute',
        reason: 'Unmuted by moderator',
      });
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !unmute (ECONNRESET)`);
      } else if (isPermDenied(error)) {
        message.reply(permMessage(lang, 'unmute')).catch(() => {});
      } else {
        console.error(`[${guildName}] Error in !unmute: ${messageFromError(error)}`);
        message.reply(t(lang, 'commands.moderation.unmute.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
