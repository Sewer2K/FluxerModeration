import { EmbedBuilder } from '@fluxerjs/core';
import type { Command } from '@/types';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import { getLevelingConfig } from '@/utils/leveling';
import LevelProfile from '@/models/LevelProfile';
import { applyXpDelta, resolveTargetUserId } from '@/utils/leveling/memberXp';
import { handleLevelUp } from '@/utils/leveling/levelUpHandler';

const command: Command = {
  name: 'givexp',
  description: 'Award xp to a member',
  usage: '<@user> <amount>',
  category: 'moderation',
  aliases: ['addxp'],
  permissions: ['ModerateMembers'],
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

    const targetId = resolveTargetUserId(message.author.id, args[0]);
    let amount: number;
    // assigns `amount` within if statement
    if (!targetId || !('1' in args) || ((amount = parseInt(args[1], 10)), !Number.isFinite(amount) || amount < 1)) {
      await message.reply(t(lang, 'commands.givexp.usage', { prefix }));
      return;
    }
    if (amount > 100_000) {
      await message.reply(t(lang, 'commands.generic.tooMuchXp'));
      return;
    }

    const result = await applyXpDelta(guildId, targetId, amount, leveling);
    if (!result) {
      await message.reply(t(lang, 'commands.givexp.failed'));
      return;
    }

    if (result.leveledUp) {
      const guild = message.guild || client.guilds?.get(guildId);
      if (guild) {
        const profile = await LevelProfile.findOne({ guildId, userId: targetId }).lean();
        await handleLevelUp(
          client,
          guild,
          targetId,
          {
            leveledUp: true,
            newLevel: result.level,
            profile: { xp: result.xp, level: result.level, messages: profile?.messages ?? 0 },
          },
          leveling,
          message.channelId ?? null,
        );
      }
    }

    const embed = new EmbedBuilder().setColor(0x6c72f8).setDescription(
      t(lang, 'commands.givexp.success', {
        amount,
        userId: targetId,
        level: result.level,
        xp: result.xp,
      }),
    );

    await message.reply({ embeds: [embed] });
  },
};

export default command;
