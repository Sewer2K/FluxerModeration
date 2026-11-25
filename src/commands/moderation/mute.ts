// legacy atp

import type { Command, MemberLike } from '@/types';
import parseUserId from '@/utils/parseUserId';
import { canModerate, getMemberHighestRolePosition } from '@/utils/permissions';
import { logModAction } from '@/utils/logger';
import formatDuration from '@/utils/formatDuration';
import settingsCache from '@/utils/settingsCache';
import ModerationLog from '@/models/ModerationLog';
import isNetworkError from '@/utils/isNetworkError';
import { isPermDenied, permMessage } from '@/utils/permError';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

const DEFAULT_MUTE_DURATION = 10 * 60 * 1000; // default mute, change if you would like :)

const command: Command = {
  name: 'mute',
  description:
    'Apply a 10-minute timeout to a member \u2014 they cannot send messages or join voice. Use !timeout for a custom duration',
  usage: '<@user or user ID> [reason]',
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

    const guildSettings = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    if (!args[0]) {
      return void (await message.reply(t(lang, 'commands.moderation.mute.usage', { prefix })));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void (await message.reply(t(lang, 'commands.generic.invalidUserInput')));
    }

    const reason = args.slice(1).join(' ').trim() || t(lang, 'commands.generic.noReasonProvided');

    let moderator = guild.members?.get(message.author.id);
    if (!moderator) {
      moderator = await guild.fetchMember(message.author.id);
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

    const modCheck = canModerate(moderator, targetMember);
    if (!modCheck.canModerate) {
      return void (await message.reply(`${modCheck.reason}`));
    }

    const botUserId = client.user?.id;
    let botMember = null;
    if (botUserId) {
      try {
        await guild.fetchRoles?.();
        botMember = await guild.fetchMember(botUserId);
      } catch {}
      if (!botMember) botMember = guild.members?.get?.(botUserId) ?? guild.members?.me;
    }
    if (botMember) {
      const checkedBotMember: MemberLike = { ...botMember };
      if (!checkedBotMember.guild) checkedBotMember.guild = guild;

      const checkedTargetMember: MemberLike = { ...targetMember };
      if (!checkedTargetMember.guild) checkedTargetMember.guild = guild;

      const botCheck = canModerate(checkedBotMember, checkedTargetMember);
      if (!botCheck.canModerate) {
        return void (await message.reply(t(lang, 'commands.moderation.mute.cannotMuteRoleHierarchy')));
      }
    }

    if (targetMember.communicationDisabledUntil && targetMember.communicationDisabledUntil > new Date()) {
      return void (await message.reply(t(lang, 'commands.moderation.mute.alreadyMuted')));
    }

    const settings = guildSettings;
    const muteRoleId = settings?.moderation?.muteRoleId || settings?.muteRoleId;
    const muteMethod: 'auto' | 'timeout' | 'mute_role' = settings?.moderation?.muteMethod || 'auto';

    try {
      const timeoutUntil = new Date(Date.now() + DEFAULT_MUTE_DURATION);

      let useMuteRole = false;
      if (muteRoleId && botMember) {
        const muteRole = guild.roles?.get(muteRoleId);
        if (muteRole) {
          const muteRolePos = typeof muteRole.position === 'number' ? muteRole.position : 0;
          const botHighest = getMemberHighestRolePosition(botMember, guild);
          if (botHighest >= 0 && muteRolePos < botHighest) {
            useMuteRole = true;
          }
        }
      }

      if (muteMethod === 'mute_role' && !useMuteRole) {
        return void (await message.reply(t(lang, 'commands.moderation.mute.muteRoleOnlyCannotApply')));
      }

      const shouldUseRole = muteMethod === 'mute_role' || (muteMethod === 'auto' && useMuteRole);
      if (shouldUseRole && muteRoleId) {
        await targetMember.roles.add(muteRoleId);

        const displayName = targetMember.user?.username || targetMember.id;
        await message.reply(
          t(lang, 'commands.moderation.mute.successMutedRole', {
            username: displayName,
            userId: targetMember.id,
            reason,
          }),
        );

        await logModAction(guild, message.author, targetMember.user || targetMember, 'mute', reason, {
          fields: [{ name: 'Method', value: 'Mute Role', inline: true }],
          client,
        });

        await ModerationLog.logAction({
          guildId: guild.id,
          targetId: targetMember.id,
          userId: message.author.id,
          action: 'mute',
          reason,
          duration: DEFAULT_MUTE_DURATION,
        });

        return;
      }

      if (muteMethod === 'mute_role') {
        return void (await message.reply(t(lang, 'commands.moderation.mute.muteRoleNotConfigured')));
      }

      await targetMember.edit({
        communicationDisabledUntil: timeoutUntil.toISOString(),
        timeoutReason: `${message.author.username}: ${reason}`,
      });

      const displayName = targetMember.user?.username || targetMember.id;
      await message.reply(
        t(lang, 'commands.moderation.mute.successMutedDuration', {
          username: displayName,
          userId: targetMember.id,
          duration: formatDuration(DEFAULT_MUTE_DURATION),
          reason,
        }),
      );

      await logModAction(guild, message.author, targetMember.user || targetMember, 'mute', reason, {
        fields: [{ name: 'Duration', value: formatDuration(DEFAULT_MUTE_DURATION), inline: true }],
        client,
      });

      await ModerationLog.logAction({
        guildId: guild.id,
        targetId: targetMember.id,
        userId: message.author.id,
        action: 'mute',
        reason,
        duration: DEFAULT_MUTE_DURATION,
      });
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !mute (ECONNRESET)`);
      } else if (isPermDenied(error)) {
        message.reply(permMessage(lang, 'mute')).catch(() => {});
      } else {
        console.error(`[${guildName}] Error in !mute: ${messageFromError(error)}`);
        message.reply(t(lang, 'commands.moderation.mute.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
