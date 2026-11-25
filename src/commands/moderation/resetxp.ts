import { EmbedBuilder } from '@fluxerjs/core';
import type { Command } from '@/types';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import { getLevelingConfig } from '@/utils/leveling';
import { resetMemberXp, resolveTargetUserId } from '@/utils/leveling/memberXp';

const command: Command = {
  name: 'resetxp',
  description: 'Reset a member xp profile',
  usage: '<@user>',
  category: 'moderation',
  permissions: ['ModerateMembers'],
  cooldown: 5,

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

    if (leveling.management.resetOwnerOnly) {
      const guild = message.guild;
      if (guild) {
        const { ownerId } = guild;
        if (ownerId && message.author.id !== ownerId) {
          await message.reply(t(lang, 'commands.resetxp.ownerOnly'));
          return;
        }
      }
    }

    const targetId = resolveTargetUserId(message.author.id, args[0]);
    if (!targetId || targetId === message.author.id) {
      await message.reply(t(lang, 'commands.resetxp.usage', { prefix }));
      return;
    }

    const removed = await resetMemberXp(guildId, targetId);
    if (!removed) {
      await message.reply(t(lang, 'commands.removexp.noXpProfile'));
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x6c72f8)
      .setDescription(t(lang, 'commands.resetxp.success', { userId: targetId }));

    await message.reply({ embeds: [embed] });
  },
};

export default command;
