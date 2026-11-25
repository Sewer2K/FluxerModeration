import { EmbedBuilder } from '@fluxerjs/core';
import type { Command } from '@/types';
import type { BanAppealDocument } from '@/models/BanAppeal';
import BanAppeal from '@/models/BanAppeal';
import GuildSettings from '@/models/GuildSettings';
import ModerationLog from '@/models/ModerationLog';
import TempBan from '@/models/TempBan';
import parseUserId from '@/utils/parseUserId';
import settingsCache from '@/utils/settingsCache';
import { appealUrl, nextAppealEligibleAt, normalizeAppealSettings } from '@/utils/banAppeals';
import { sendUserDm } from '@/utils/sendUserDm';
import { isUserNotBannedError } from '@/commands/moderation/unban';
import { messageFromError } from '@/utils/messageFromError';
import { t, normalizeLocale } from '@/i18n';

function truncate(value: string, max = 1000): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function dateText(value: Date | null): string {
  return value ? value.toLocaleString() : 'None';
}

function appealFieldValue(appeal: BanAppealDocument): string {
  const answers = appeal.answers ?? {
    whatHappened: '',
    whyLift: '',
    whatDifferent: '',
    evidence: '',
    onlyFluxerAccount: null,
  };
  return [
    `**State:** ${appeal.state}`,
    `**User:** ${appeal.userId}`,
    `**Case:** ${appeal.caseNumber ? `#${appeal.caseNumber}` : 'Unknown'}`,
    `**Ban reason:** ${truncate(appeal.banReason || 'No reason provided')}`,
    `**Submitted:** ${dateText(appeal.submittedAt)}`,
    `**Next eligible:** ${dateText(appeal.nextEligibleAt)}`,
    `**What happened:** ${truncate(answers.whatHappened)}`,
    `**Why lift it:** ${truncate(answers.whyLift)}`,
    `**What changes:** ${truncate(answers.whatDifferent)}`,
    ...(answers.evidence ? [`**Evidence:** ${truncate(answers.evidence)}`] : []),
    ...(answers.onlyFluxerAccount ? [`**Only Fluxer account:** ${answers.onlyFluxerAccount}`] : []),
    ...(appeal.staffReason ? [`**Staff note:** ${truncate(appeal.staffReason)}`] : []),
  ].join('\n');
}

async function getGuild(message: Parameters<Command['execute']>[0], client: Parameters<Command['execute']>[2]) {
  let guild = message.guild;
  if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
  return guild;
}

async function updateSetting(
  guildId: string,
  settings: Awaited<ReturnType<typeof settingsCache.getOrCreate>>,
  patch: ReturnType<typeof normalizeAppealSettings>,
): Promise<void> {
  await GuildSettings.updateSetting(guildId, 'appeals', patch);
  settingsCache.invalidate(guildId);
  settings.appeals = patch;
}

const command: Command = {
  name: 'appeal',
  aliases: ['appeals'],
  description:
    'Review ban appeals from outside the server. Appeals are submitted through the link sent to banned users.',
  usage:
    'list [user ID] | view <user ID> | approve|deny|dismiss|blacklist <user ID> [note] | link <user ID> | config ...',
  category: 'moderation',
  permissions: ['BanMembers'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    const guild = await getGuild(message, client);
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));

    const settings = await settingsCache.getOrCreate(guild.id);
    const lang = normalizeLocale(settings.language);
    const subcommand = args[0]?.toLowerCase() || 'list';

    if (subcommand === 'config') {
      const current = normalizeAppealSettings(settings.appeals);
      const setting = args[1]?.toLowerCase();
      if (!setting) {
        return void (await message.reply(
          t(lang, 'commands.moderation.appeal.configStatus', {
            enabled: current.enabled ? 'on' : 'off',
            channelId: current.channelId || 'mod log fallback',
            cooldownDays: current.cooldownDays,
            tempBans: current.allowTempBans ? 'on' : 'off',
            defaultNoAppeal: current.defaultNoAppeal ? 'on' : 'off',
            prefix,
          }),
        ));
      }

      const value = args[2]?.toLowerCase();
      if (setting === 'channel') {
        const channelId = value === 'none' ? null : value && /^\d{17,20}$/.test(value) ? value : null;
        if (!channelId && value !== 'none') {
          return void (await message.reply(t(lang, 'commands.moderation.appeal.configInvalidChannel')));
        }
        await updateSetting(guild.id, settings, { ...current, channelId });
      } else if (setting === 'cooldown') {
        const cooldownDays = Number(value);
        if (!Number.isInteger(cooldownDays) || cooldownDays < 0 || cooldownDays > 365) {
          return void (await message.reply(t(lang, 'commands.moderation.appeal.configInvalidCooldown')));
        }
        await updateSetting(guild.id, settings, { ...current, cooldownDays });
      } else if (setting === 'enabled' || setting === 'tempbans' || setting === 'defaultnoappeal') {
        if (value !== 'on' && value !== 'off') {
          return void (await message.reply(t(lang, 'commands.moderation.appeal.configToggleUsage', { prefix })));
        }
        const enabled = value === 'on';
        await updateSetting(guild.id, settings, {
          ...current,
          ...(setting === 'enabled' ? { enabled } : {}),
          ...(setting === 'tempbans' ? { allowTempBans: enabled } : {}),
          ...(setting === 'defaultnoappeal' ? { defaultNoAppeal: enabled } : {}),
        });
      } else {
        return void (await message.reply(t(lang, 'commands.moderation.appeal.configUsage', { prefix })));
      }

      return void (await message.reply(t(lang, 'commands.moderation.appeal.configSaved')));
    }

    if (subcommand === 'list' || parseUserId(subcommand)) {
      const userId = subcommand === 'list' ? parseUserId(args[1] || '') : parseUserId(subcommand);
      const appeals = await BanAppeal.find({ guildId: guild.id, state: 'pending', ...(userId ? { userId } : {}) })
        .sort({ submittedAt: 1 })
        .limit(25);

      if (appeals.length === 0) {
        return void (await message.reply(t(lang, 'commands.moderation.appeal.nonePending')));
      }

      const embed = new EmbedBuilder().setTitle(t(lang, 'commands.moderation.appeal.pendingTitle')).setColor(0xf59e0b);
      for (const appeal of appeals) {
        embed.addFields({
          name: `${appeal.userId}${appeal.caseNumber ? ` • #${appeal.caseNumber}` : ''}`,
          value: appealFieldValue(appeal).slice(0, 1024),
        });
      }
      return void (await message.reply({ embeds: [embed] }));
    }

    const userId = parseUserId(args[1] || '');
    if (!userId) return void (await message.reply(t(lang, 'commands.moderation.appeal.userUsage', { prefix })));

    const appeal = await BanAppeal.findLatest(guild.id, userId);
    if (subcommand === 'view') {
      if (!appeal) return void (await message.reply(t(lang, 'commands.moderation.appeal.notFound')));
      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'commands.moderation.appeal.viewTitle', { userId }))
        .setColor(0x5865f2)
        .setDescription(appealFieldValue(appeal).slice(0, 4096));
      return void (await message.reply({ embeds: [embed] }));
    }

    if (subcommand === 'link') {
      if (!appeal?.eligible || appeal.state === 'blacklisted') {
        return void (await message.reply(t(lang, 'commands.moderation.appeal.linkUnavailable')));
      }
      const url = appealUrl(guild.id, userId);
      if (!url) return void (await message.reply(t(lang, 'commands.moderation.appeal.linkUnavailable')));
      const sent = await sendUserDm(client, message.author.id, `Appeal link for ${userId}: ${url}`);
      return void (await message.reply(
        t(lang, sent ? 'commands.moderation.appeal.linkSent' : 'commands.moderation.appeal.linkDmFailed'),
      ));
    }

    if (!['approve', 'deny', 'dismiss', 'blacklist'].includes(subcommand)) {
      return void (await message.reply(t(lang, 'commands.moderation.appeal.usage', { prefix })));
    }
    if (!appeal) return void (await message.reply(t(lang, 'commands.moderation.appeal.notFound')));
    if (appeal.state !== 'pending') {
      return void (await message.reply(t(lang, 'commands.moderation.appeal.notPending', { state: appeal.state })));
    }

    const note = truncate(args.slice(2).join(' ') || '');
    if (subcommand === 'approve') {
      try {
        await guild.unban(userId);
      } catch (error: unknown) {
        if (!isUserNotBannedError(error)) {
          return void (await message.reply(t(lang, 'commands.moderation.appeal.approveFailed')));
        }
      }

      const reason = `Ban appeal approved${note ? `: ${note}` : ''}`;
      await TempBan.deleteMany({ guildId: guild.id, userId });
      await ModerationLog.logAction({
        guildId: guild.id,
        targetId: userId,
        userId: message.author.id,
        action: 'unban',
        reason,
      }).catch((error: unknown) => {
        console.warn(`[${guild.name}] Failed to log appeal approval: ${messageFromError(error)}`);
      });
      await BanAppeal.updateOne(
        { _id: appeal._id, state: 'pending' },
        {
          $set: {
            state: 'approved',
            eligible: false,
            decidedAt: new Date(),
            decidedBy: message.author.id,
            staffReason: note,
            nextEligibleAt: null,
          },
          $push: { history: { at: new Date(), by: message.author.id, action: 'approve', note } },
        },
      );
      await sendUserDm(
        client,
        userId,
        `Your ban appeal for **${guild.name}** was approved. You may rejoin the server.`,
      );
      return void (await message.reply(t(lang, 'commands.moderation.appeal.approved', { userId })));
    }

    const isBlacklist = subcommand === 'blacklist';
    const nextEligibleAt = isBlacklist
      ? null
      : nextAppealEligibleAt(
          subcommand === 'dismiss' ? 'dismiss' : 'deny',
          normalizeAppealSettings(settings.appeals).cooldownDays,
        );
    const state = isBlacklist ? 'blacklisted' : subcommand === 'deny' ? 'denied' : 'dismissed';
    await BanAppeal.updateOne(
      { _id: appeal._id, state: 'pending' },
      {
        $set: {
          state,
          eligible: isBlacklist ? false : appeal.eligible,
          decidedAt: new Date(),
          decidedBy: message.author.id,
          staffReason: note,
          nextEligibleAt,
        },
        $push: {
          history: {
            at: new Date(),
            by: message.author.id,
            action: state === 'blacklisted' ? 'blacklist' : state,
            note,
          },
        },
      },
    );

    if (subcommand === 'deny') {
      await sendUserDm(
        client,
        userId,
        `Your ban appeal for **${guild.name}** was denied.${note ? ` Reason: ${note}` : ''} You may try again after ${dateText(nextEligibleAt)}.`,
      );
    } else if (subcommand === 'dismiss') {
      await sendUserDm(
        client,
        userId,
        `Your ban appeal for **${guild.name}** needs more information before it can be reviewed.`,
      );
    }

    return void (await message.reply(t(lang, 'commands.moderation.appeal.decisionSaved', { state })));
  },
};

export default command;
