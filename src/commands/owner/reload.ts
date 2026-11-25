import path from 'path';
import type { Command } from '@/types';
import config from '@/config';
import isNetworkError from '@/utils/isNetworkError';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import { isArray } from '@/utils/isArray';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'reload',
  description: 'Reload a command',
  usage: '<command>',
  category: 'owner',
  ownerOnly: true,
  cooldown: 0,

  async execute(message, args, client) {
    if (config.ownerId && message.author.id !== config.ownerId) {
      const guildId = message.guildId || message.guild?.id;
      const guildSettings = guildId ? await settingsCache.get(guildId).catch(() => null) : null;
      const lang = normalizeLocale(guildSettings?.language);
      return void (await message.reply(t(lang, 'commands.reload.ownerOnly')));
    }

    if (!args[0]) {
      return void (await message.reply(t('en', 'commands.reload.usage', { prefix: config.prefix })));
    }

    const commandName = args[0].toLowerCase();

    const commandHandler = client.commandHandler;

    if (!commandHandler) {
      const guildId = message.guildId || message.guild?.id;
      const guildSettings = guildId ? await settingsCache.get(guildId).catch(() => null) : null;
      const lang = normalizeLocale(guildSettings?.language);
      return void (await message.reply(t(lang, 'commands.generic.handlerMissing')));
    }

    const oldCommand = commandHandler.getCommand(commandName);

    if (!oldCommand) {
      const guildId = message.guildId || message.guild?.id;
      const guildSettings = guildId ? await settingsCache.get(guildId).catch(() => null) : null;
      const lang = normalizeLocale(guildSettings?.language);
      return void (await message.reply(t(lang, 'commands.reload.commandNotFound', { commandName })));
    }

    try {
      const commandsPath = path.join(__dirname, '..', '..', 'commands');
      const category = oldCommand.category;

      let commandPath: string;
      try {
        commandPath = require.resolve(path.join(commandsPath, category, `${oldCommand.name}.ts`));
      } catch {
        commandPath = require.resolve(path.join(commandsPath, category, `${oldCommand.name}.js`));
      }

      delete require.cache[commandPath];

      const imported = require(commandPath);
      const newCommand = imported.default || imported;

      commandHandler.commands.delete(oldCommand.name);
      if (oldCommand.aliases) {
        for (const alias of oldCommand.aliases) {
          commandHandler.commands.delete(alias);
        }
      }

      commandHandler.commands.set(newCommand.name, {
        ...newCommand,
        category,
      });

      if (newCommand.aliases && isArray(newCommand.aliases)) {
        for (const alias of newCommand.aliases) {
          commandHandler.commands.set(alias, {
            ...newCommand,
            category,
            isAlias: true,
          });
        }
      }

      const guildId = message.guildId || message.guild?.id;
      const guildSettings = guildId ? await settingsCache.get(guildId).catch(() => null) : null;
      const lang = normalizeLocale(guildSettings?.language);
      await message.reply(t(lang, 'commands.reload.success', { commandName: newCommand.name }));
    } catch (error) {
      if (isNetworkError(error)) {
        console.warn(`Fluxer API unreachable during !reload (ECONNRESET)`);
      } else {
        const errorMessage = `${messageFromError(error)}`;
        console.error(`Error in !reload: ${errorMessage}`);
        const guildId = message.guildId || message.guild?.id;
        const guildSettings = guildId ? await settingsCache.get(guildId).catch(() => null) : null;
        const lang = normalizeLocale(guildSettings?.language);
        message.reply(t(lang, 'commands.reload.error', { error: errorMessage })).catch(() => {});
      }
    }
  },
};

export default command;
