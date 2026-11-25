import { EmbedBuilder } from '@fluxerjs/core';
import type { Command, IModerationLog } from '@/types';
import type { ModerationAction } from '@/types';
import parseUserId from '@/utils/parseUserId';
import ModerationLog from '@/models/ModerationLog';
import formatDuration from '@/utils/formatDuration';
import isNetworkError from '@/utils/isNetworkError';
import settingsCache from '@/utils/settingsCache';
import { registerReactionPaginator } from '@/utils/reactionPaginator';
import { formatCompactPageIndicator, joinCompactFooterParts } from '@/utils/embedPresentation';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

const PAGE_SIZE = 8;
const MAX_LOGS = 400;

const VALID_ACTIONS: ModerationAction[] = [
  'ban',
  'unban',
  'kick',
  'mute',
  'unmute',
  'warn',
  'unwarn',
  'clearwarn',
  'slowmode',
  'unlock',
  'purge',
  'softban',
  'tempban',
  'tempmute',
  'timeout',
  'nickname',
  'role_add',
  'role_remove',
  'other',
];

const ACTION_LABELS: Record<ModerationAction, string> = {
  ban: 'Ban',
  unban: 'Unban',
  kick: 'Kick',
  mute: 'Mute',
  unmute: 'Unmute',
  warn: 'Warn',
  unwarn: 'Unwarn',
  clearwarn: 'Clear warnings',
  slowmode: 'Slowmode',
  unlock: 'Unlock',
  purge: 'Purge',
  softban: 'Softban',
  tempban: 'Temp ban',
  tempmute: 'Temp mute',
  timeout: 'Timeout',
  nickname: 'Nickname',
  role: 'Role', // honey-pot related
  role_add: 'Role add',
  role_remove: 'Role remove',
  other: 'Other',
};

const ACTION_ICONS: Partial<Record<ModerationAction, string>> = {
  ban: '🔨',
  unban: '🔓',
  kick: '👢',
  mute: '🔇',
  unmute: '🔊',
  warn: '⚠️',
  unwarn: '✅',
  clearwarn: '🧹',
  timeout: '⏱️',
  tempban: '🔨',
  tempmute: '🔇',
  purge: '🗑️',
  softban: '🔨',
};

function formatAction(action: ModerationAction): string {
  const icon = ACTION_ICONS[action] ? `${ACTION_ICONS[action]} ` : '';
  return `${icon}${ACTION_LABELS[action] ?? action}`;
}

function formatCaseDate(timestamp: Date | string | undefined): string {
  if (!timestamp) return '?';
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function truncateField(text: string, max = 900): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function buildCaseField(log: IModerationLog, lang: string): { name: string; value: string } {
  const caseNum = log.metadata?.caseNumber ?? '?';
  const action = log.action as ModerationAction;
  const date = formatCaseDate(log.timestamp);
  const reason = log.reason || t(lang, 'commands.generic.noReasonProvided');

  const lines =
    action === 'purge'
      ? [
          `**Channel:** ${log.metadata?.channelId ? `<#${log.metadata.channelId}>` : log.metadata?.channelName || 'Unknown'}`,
          `**Messages Deleted:** ${log.metadata?.messageCount ?? 0}`,
          `**Moderator:** <@${log.userId}>`,
        ]
      : [`**Target:** <@${log.targetId}>`, `**Moderator:** <@${log.userId}>`];
  if (log.duration) {
    lines.push(`**Duration:** ${formatDuration(log.duration)}`);
  }
  lines.push(`**Reason:** ${truncateField(reason)}`);

  return {
    name: `#${caseNum} • ${formatAction(action)} • ${date}`,
    value: lines.join('\n'),
  };
}

function buildFiltersSummary(
  lang: string,
  filters: { targetId?: string; moderatorId?: string; action?: ModerationAction },
): string | null {
  const parts: string[] = [];
  if (filters.targetId) parts.push(`${t(lang, 'commands.moderation.modlogs.fieldTarget')}: <@${filters.targetId}>`);
  if (filters.moderatorId)
    parts.push(`${t(lang, 'commands.moderation.modlogs.fieldModerator')}: <@${filters.moderatorId}>`);
  if (filters.action)
    parts.push(`${t(lang, 'commands.moderation.modlogs.fieldAction')}: ${formatAction(filters.action)}`);
  return parts.length ? parts.join(' • ') : null;
}

function buildListPageEmbed(opts: {
  logs: IModerationLog[];
  lang: string;
  prefix: string;
  pageNumber: number;
  totalPages: number;
  filtersSummary: string | null;
  truncated?: { shown: number; total: number };
}): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(t(opts.lang, 'commands.moderation.modlogs.title')).setColor(0x3498db);

  const descriptionParts: string[] = [];
  if (opts.filtersSummary) descriptionParts.push(opts.filtersSummary);
  if (opts.truncated) {
    descriptionParts.push(
      t(opts.lang, 'commands.moderation.modlogs.footerTruncated', {
        count: opts.truncated.shown,
        total: opts.truncated.total,
      }),
    );
  }
  if (descriptionParts.length) embed.setDescription(descriptionParts.join('\n'));

  for (const log of opts.logs) {
    embed.addFields(buildCaseField(log, opts.lang));
  }

  embed.setFooter({
    text: joinCompactFooterParts([
      t(opts.lang, 'commands.moderation.modlogs.footerHint', { prefix: opts.prefix }),
      formatCompactPageIndicator(opts.pageNumber, opts.totalPages),
    ]),
  });

  return embed;
}

const command: Command = {
  name: 'modlogs',
  description:
    'Search moderation cases. Filter by user, action type, or moderator. Use "case <number>" to view a single case in detail.',
  usage: '[@user] [action:<type>] [mod:@moderator] | case <number>',
  category: 'moderation',
  aliases: ['cases', 'modlog'],
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

    try {
      if (args[0]?.toLowerCase() === 'case') {
        let caseNumber: number;
        // assigns `caseNumber` within if statement
        if (!('1' in args) || ((caseNumber = parseInt(args[1], 10)), !caseNumber || caseNumber < 1)) {
          return void (await message.reply(t(lang, 'commands.moderation.modlogs.invalidCase', { prefix })));
        }

        const log = await ModerationLog.getCase(guild.id, caseNumber);
        if (!log) {
          return void (await message.reply(t(lang, 'commands.moderation.modlogs.caseNotFound', { caseNumber })));
        }

        const caseFields = [
          {
            name: t(lang, 'commands.moderation.modlogs.fieldAction'),
            value: formatAction(log.action),
            inline: true,
          },
          log.action === 'purge'
            ? {
                name: 'Channel',
                value: log.metadata?.channelId
                  ? `<#${log.metadata.channelId}>`
                  : log.metadata?.channelName || 'Unknown',
                inline: true,
              }
            : { name: t(lang, 'commands.moderation.modlogs.fieldTarget'), value: `<@${log.targetId}>`, inline: true },
          { name: t(lang, 'commands.moderation.modlogs.fieldModerator'), value: `<@${log.userId}>`, inline: true },
          {
            name: t(lang, 'commands.moderation.modlogs.fieldReason'),
            value: truncateField(log.reason || t(lang, 'commands.generic.noReasonProvided'), 1000),
          },
        ];
        if (log.action === 'purge') {
          caseFields.push({
            name: 'Messages Deleted',
            value: String(log.metadata?.messageCount ?? 0),
            inline: true,
          });
        }

        const embed = new EmbedBuilder()
          .setTitle(t(lang, 'commands.moderation.modlogs.caseTitle', { caseNumber }))
          .setColor(0x3498db)
          .addFields(...caseFields);

        if (log.duration) {
          embed.addFields({
            name: t(lang, 'commands.moderation.modlogs.fieldDuration'),
            value: formatDuration(log.duration),
            inline: true,
          });
        }

        if (log.timestamp) {
          embed.setTimestamp(new Date(log.timestamp));
        }

        return void (await message.reply({ embeds: [embed] }));
      }

      let targetId: string | undefined;
      let moderatorId: string | undefined;
      let action: ModerationAction | undefined;

      for (const arg of args) {
        const lower = arg.toLowerCase();
        if (lower.startsWith('action:')) {
          const value = lower.slice(7) as ModerationAction;
          if (!VALID_ACTIONS.includes(value)) {
            return void (await message.reply(
              t(lang, 'commands.moderation.modlogs.invalidAction', { actions: VALID_ACTIONS.join(', ') }),
            ));
          }
          action = value;
        } else if (lower.startsWith('mod:')) {
          const parsed = parseUserId(arg.slice(4));
          if (!parsed) {
            return void (await message.reply(t(lang, 'commands.generic.invalidUserInput')));
          }
          moderatorId = parsed;
        } else {
          const parsed = parseUserId(arg);
          if (!parsed) {
            return void (await message.reply(t(lang, 'commands.generic.invalidUserInput')));
          }
          targetId = parsed;
        }
      }

      const query = { action, userId: moderatorId, targetId };
      const totalCount = await ModerationLog.countGuildLogs(guild.id, query);
      const fetchLimit = Math.min(totalCount, MAX_LOGS);
      const logs =
        fetchLimit > 0
          ? await ModerationLog.getGuildLogs(guild.id, {
              ...query,
              limit: fetchLimit,
              skip: 0,
            })
          : [];

      const filtersSummary = buildFiltersSummary(lang, { targetId, moderatorId, action });

      if (logs.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle(t(lang, 'commands.moderation.modlogs.title'))
          .setColor(0x3498db)
          .setDescription(
            filtersSummary
              ? `${filtersSummary}\n\n${t(lang, 'commands.moderation.modlogs.noResults')}`
              : t(lang, 'commands.moderation.modlogs.noResults'),
          );
        return void (await message.reply({ embeds: [embed] }));
      }

      const totalPages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
      const truncated = totalCount > logs.length ? { shown: logs.length, total: totalCount } : undefined;

      const pages = Array.from({ length: totalPages }, (_, pageIndex) => {
        const pageLogs = logs.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);
        return buildListPageEmbed({
          logs: pageLogs,
          lang,
          prefix,
          pageNumber: pageIndex + 1,
          totalPages,
          filtersSummary,
          truncated: pageIndex === 0 ? truncated : undefined,
        });
      });

      const sentMessage = await message.reply({
        embeds: [pages[0]! /* the length of `pages` has a minimum length of 1 */],
      });

      if (pages.length > 1) {
        const ownerUserId = message.author.id;
        const responseChannelId = sentMessage.channelId;
        const responseMessageId = sentMessage.id;

        if (ownerUserId && responseChannelId && responseMessageId) {
          await registerReactionPaginator(client, {
            messageId: responseMessageId,
            channelId: responseChannelId,
            ownerUserId,
            pages,
            initialPageIndex: 0,
            ttlMs: 3 * 60 * 1000,
            targetMessage: sentMessage,
          });
        }
      }
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !modlogs (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !modlogs: ${messageFromError(error)}`);
        message.reply(t(lang, 'commands.moderation.modlogs.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
