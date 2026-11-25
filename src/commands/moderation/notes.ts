import { EmbedBuilder, type User } from '@fluxerjs/core';
import type { Command } from '@/types';
import parseUserId from '@/utils/parseUserId';
import Note from '@/models/Note';
import isNetworkError from '@/utils/isNetworkError';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'notes',
  description: 'View staff notes for a user',
  usage: '[@user or user ID]',
  category: 'moderation',
  permissions: ['ModerateMembers'],
  cooldown: 3,

  async execute(message, args, client) {
    let guild = message.guild;
    if (!guild && message.guildId) {
      guild = await client.guilds.fetch(message.guildId);
    }

    if (!guild) {
      return void (await message.reply(t('en', 'commands.generic.serverOnly')));
    }

    const guildSettings = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(guildSettings?.language);

    let userId: string;

    if (args[0]) {
      const parsed = parseUserId(args[0]);
      if (!parsed) {
        return void (await message.reply(t(lang, 'commands.generic.invalidUserInput')));
      }
      userId = parsed;
    } else {
      userId = message.author.id;
    }

    let targetUser: Pick<User, 'id' | 'username'>;
    try {
      targetUser = await client.users.fetch(userId);
    } catch {
      targetUser = { id: userId, username: t(lang, 'commands.userinfo.unknown') };
    }

    try {
      const noteRecord = await Note.getUserNotes(guild.id, userId);
      const notes = noteRecord.notes || [];

      const embed = new EmbedBuilder()
        .setTitle(`Staff Notes for ${targetUser.username || targetUser.id}`)
        .setColor(0x9b59b6);

      if (notes.length === 0) {
        embed.setDescription('No notes recorded for this user.');
      } else {
        const noteList: string[] = [];
        notes.forEach((note, i) => {
          const date = note.date ? new Date(note.date).toLocaleDateString() : 'Unknown';
          const modMention = note.modId ? `<@${note.modId}>` : 'Unknown';

          noteList.push(`**${i + 1}.** ${note.content}`);
          noteList.push(`   └ Moderator: ${modMention} | Date: ${date}`);
        });

        embed.addFields({
          name: 'Notes',
          value: noteList.join('\n') || 'None',
        });

        embed.setFooter({ text: `Total Notes: ${notes.length}` });
      }

      await message.reply({ embeds: [embed] });
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !notes (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !notes: ${messageFromError(error)}`);
        message.reply(t(lang, 'commands.moderation.warnings.errors.generic')).catch(() => {});
      }
    }
  },
};

export default command;
