import type { User } from '@fluxerjs/core';
import type { Command } from '@/types';
import parseUserId from '@/utils/parseUserId';
import Note from '@/models/Note';
import isNetworkError from '@/utils/isNetworkError';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'clearnotes',
  description: "Clear all recorded staff notes from a user's history",
  usage: '<@user or user ID>',
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
      return void (await message.reply(`Usage: \`${prefix}clearnotes <@user or user ID>\``));
    }

    const userId = parseUserId(args[0]);
    if (!userId) {
      return void (await message.reply('Invalid user. Please provide a valid user mention or ID.'));
    }

    try {
      const record = await Note.getUserNotes(guild.id, userId);
      const count = record.notes.length;

      if (count === 0) {
        return void (await message.reply('This user has no notes to clear.'));
      }

      await Note.clearNotes(guild.id, userId);

      let targetUser: Pick<User, 'id' | 'username'> | null = null;
      try {
        targetUser = await client.users.fetch(userId);
      } catch {
        targetUser = { id: userId, username: 'Unknown User' };
      }

      const displayName = targetUser.username || targetUser.id;
      await message.reply(`Cleared ${count} note${count !== 1 ? 's' : ''} for **${displayName}** (${targetUser.id}).`);
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !clearnotes (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !clearnotes: ${messageFromError(error)}`);
        message.reply('An error occurred while clearing notes. Please try again.').catch(() => {});
      }
    }
  },
};

export default command;
