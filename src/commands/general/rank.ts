import { EmbedBuilder, GuildMember, User } from '@fluxerjs/core';
import type { Command } from '@/types';
import LevelProfile from '@/models/LevelProfile';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import { getLevelingConfig, totalXpForLevel, xpForLevel } from '@/utils/leveling';
import { generateRankCard } from '@/utils/leveling/rankCard';
import {
  levelForXp,
  resolveMemberAvatarUrl,
  resolveMemberUsername,
  resolveTargetUserId,
} from '@/utils/leveling/memberXp';
import { replyMessage } from '@/utils/sendMessage';

const command: Command = {
  name: 'rank',
  aliases: ['level', 'xp'],
  description: 'Check your level and xp (or someone elses)',
  usage: '[@user]',
  category: 'general',
  cooldown: 3,

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

    if (leveling.management.rankCommandOwnerOnly) {
      const guild = message.guild || client.guilds?.get(guildId);
      const ownerId = guild?.ownerId ?? null;
      if (ownerId && message.author.id !== ownerId) {
        await message.reply(t(lang, 'commands.rank.ownerOnly'));
        return;
      }
    }

    const targetId = resolveTargetUserId(message.author.id, args[0]);
    if (!targetId) {
      await message.reply(t(lang, 'commands.generic.invalidUserInput'));
      return;
    }

    const profile = await LevelProfile.findOne({ guildId, userId: targetId }).lean();
    if (!profile) {
      await message.reply(t(lang, 'commands.rank.noXp'));
      return;
    }

    const rank = await LevelProfile.getRank(guildId, targetId);
    const formula = leveling.formula;
    const level = levelForXp(profile.xp, formula);
    const intoLevel = Math.max(0, profile.xp - totalXpForLevel(level, formula));
    const needed = xpForLevel(level, formula);

    const guild = message.guild || client.guilds?.get(guildId);
    let avatarSubject: GuildMember | User | null = guild?.members?.get(targetId) ?? null;
    if (!avatarSubject && guild) {
      avatarSubject = await guild.fetchMember(targetId).catch(() => null);
    }
    if (!avatarSubject) {
      avatarSubject = (await client.users.fetch(targetId).catch(() => null)) ?? null;
    }
    const username = resolveMemberUsername(avatarSubject, targetId);
    const avatarURL = resolveMemberAvatarUrl(avatarSubject);

    try {
      const png = await generateRankCard({
        username,
        avatarURL,
        level,
        xp: profile.xp,
        rank,
        formula: leveling.formula,
        settings: leveling.rankCard,
      });
      await replyMessage(message, {
        content: `<@${targetId}>`,
        files: [{ name: 'rank.png', data: png }],
      });
      return;
    } catch {}

    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'commands.rank.title'))
      .setColor(0x6c72f8)
      .addFields(
        { name: t(lang, 'commands.rank.level'), value: String(level), inline: true },
        { name: t(lang, 'commands.rank.rank'), value: rank ? `#${rank}` : '—', inline: true },
        { name: t(lang, 'commands.rank.progress'), value: `${intoLevel} / ${needed} xp`, inline: true },
        { name: t(lang, 'commands.rank.totalXp'), value: String(profile.xp), inline: true },
        { name: t(lang, 'commands.rank.messages'), value: String(profile.messages), inline: true },
      );

    await message.reply({ content: `<@${targetId}>`, embeds: [embed] });
  },
};

export default command;
