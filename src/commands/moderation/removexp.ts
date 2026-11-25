import { EmbedBuilder } from '@fluxerjs/core';
import type { Command } from '@/types';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import { getLevelingConfig } from '@/utils/leveling';
import { applyXpDelta, resolveTargetUserId } from '@/utils/leveling/memberXp';

const command: Command = {
  name: 'removexp',
  description: 'Remove xp from a member',
  usage: '<@user> <amount>',
  category: 'moderation',
  aliases: ['takexp'],
  permissions: ['ModerateMembers'],
  cooldown: 3,

  async execute(message, args, _client, prefix = '!') {
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
      await message.reply(t(lang, 'commands.removexp.usage', { prefix }));
      return;
    }
    if (amount > 100_000) {
      await message.reply(t(lang, 'commands.generic.tooMuchXp'));
      return;
    }

    const result = await applyXpDelta(guildId, targetId, -amount, leveling);
    if (!result) {
      await message.reply(t(lang, 'commands.removexp.noXpProfile'));
      return;
    }

    const embed = new EmbedBuilder().setColor(0x6c72f8).setDescription(
      t(lang, 'commands.removexp.success', {
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
