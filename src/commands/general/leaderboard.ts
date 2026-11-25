import { EmbedBuilder } from '@fluxerjs/core';
import type { Command } from '@/types';
import LevelProfile from '@/models/LevelProfile';
import settingsCache from '@/utils/settingsCache';
import { registerReactionPaginator } from '@/utils/reactionPaginator';
import { formatPaginatorFooter } from '@/utils/embedPresentation';
import { t, normalizeLocale } from '@/i18n';
import { getLevelingConfig } from '@/utils/leveling';
import {
  leaderboardSortField,
  levelForXp,
  parseLeaderboardPeriod,
  type LeaderboardPeriod,
} from '@/utils/leveling/memberXp';

const PAGE_SIZE = 10;
const MAX_ENTRIES = 50;

function periodTitle(lang: string, period: LeaderboardPeriod): string {
  if (period === 'weekly') return t(lang, 'commands.leaderboard.titleWeekly');
  if (period === 'monthly') return t(lang, 'commands.leaderboard.titleMonthly');
  return t(lang, 'commands.leaderboard.title');
}

function formatEntry(lang: string, period: LeaderboardPeriod, level: number, xp: number): string {
  if (period === 'weekly') return t(lang, 'commands.leaderboard.entryWeekly', { level, xp });
  if (period === 'monthly') return t(lang, 'commands.leaderboard.entryMonthly', { level, xp });
  return t(lang, 'commands.leaderboard.entry', { level, xp });
}

function rankEmoji(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `**${rank}.**`;
}

function buildPageEmbed(
  rows: Array<{ userId: string; level: number; xp: number }>,
  opts: { lang: string; period: LeaderboardPeriod; page: number; totalPages: number; prefix: string },
): EmbedBuilder {
  const startRank = (opts.page - 1) * PAGE_SIZE;
  const lines = rows.map((row, i) => {
    const rank = startRank + i + 1;
    return `${rankEmoji(rank)} <@${row.userId}> — ${formatEntry(opts.lang, opts.period, row.level, row.xp)}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(periodTitle(opts.lang, opts.period))
    .setColor(0x6c72f8)
    .setDescription(lines.join('\n'));

  const footer = formatPaginatorFooter(
    t(opts.lang, 'commands.leaderboard.footerHint', { prefix: opts.prefix }),
    opts.page,
    opts.totalPages,
  );
  if (footer) embed.setFooter({ text: footer });

  return embed;
}

const command: Command = {
  name: 'leaderboard',
  aliases: ['lb', 'top'],
  description: 'Show the top members by xp',
  usage: '[weekly|monthly]',
  category: 'general',
  cooldown: 5,

  async execute(message, args, client, prefix = '!') {
    const guildId = message.guildId || message.guild?.id;
    if (!guildId) return;

    const settings = await settingsCache.get(guildId).catch(() => null);
    const lang = normalizeLocale(settings?.language);
    const leveling = getLevelingConfig(settings);

    if (!leveling.enabled) {
      await message.reply(t(lang, 'commands.generic.levelingDisabled', { prefix }));
      return;
    }

    const period = parseLeaderboardPeriod(args[0]);
    if (args[0] && period === null) {
      await message.reply(t(lang, 'commands.leaderboard.invalidPeriod', { prefix }));
      return;
    }
    const resolvedPeriod = period ?? 'all';

    const sortField = leaderboardSortField(resolvedPeriod);
    const top = await LevelProfile.getTop(guildId, MAX_ENTRIES, sortField);
    if (!top.length) {
      await message.reply(t(lang, 'commands.leaderboard.empty'));
      return;
    }

    const rows = top.map((p) => ({
      userId: p.userId,
      level: levelForXp(p.xp, leveling.formula),
      xp: p[sortField] ?? p.xp,
    }));

    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const pages = Array.from({ length: totalPages }, (_, pageIndex) => {
      const slice = rows.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);
      return buildPageEmbed(slice, {
        lang,
        period: resolvedPeriod,
        page: pageIndex + 1,
        totalPages,
        prefix,
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
  },
};

export default command;
