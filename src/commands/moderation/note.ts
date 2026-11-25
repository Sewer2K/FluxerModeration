import type { User } from '@fluxerjs/core';
import type { Command } from '@/types';
import Note from '@/models/Note';
import parseUserId from '@/utils/parseUserId';
import isNetworkError from '@/utils/isNetworkError';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'note',
  description: 'Add a private staff note to a user',
  usage: '<@user or user ID> <content>',
  category: 'moderation',
  permissions: ['ModerateMembers'],
  cooldown: 3,

  async execute(message, args, client, prefix = '!') {
    let guild = message.guild;
    if (!guild && message.guildId) {
      guild = await client.guilds.fetch(message.guildId);
    }

    if (!guild) {
      return void (await message.reply('This command can only be used in a server.'));
    }

    if (!args[0]) {
      return void (await message.reply(`Usage: ${prefix}note <@user or user ID> <content>`));
    }

    if (!args[1]) {
      return void (await message.reply('Please provide note content.'));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void (await message.reply('Invalid user. Please mention a user or provide a valid user ID.'));
    }

    const content = args.slice(1).join(' ').trim();

    try {
      await Note.addNote(guild.id, userId, message.author.id, content);

      let targetUser: Pick<User, 'id' | 'username'>;
      try {
        targetUser = await client.users.fetch(userId);
      } catch {
        targetUser = { id: userId, username: 'Unknown' };
      }

      const displayName = targetUser.username || targetUser.id;
      await message.reply(`Note added for **${displayName}** (\`${targetUser.id}\`)\n> ${content}`);
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !note (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !note: ${messageFromError(error)}`);
        message.reply('An error occurred while adding the note. Please try again.').catch(() => {});
      }
    }
  },
};

export default command;
