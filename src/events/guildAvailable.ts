import type { BotEvent } from '@/types';
import type { Guild } from '@fluxerjs/core';
import { initializeGuild } from './guildCreate';

const event: BotEvent = {
  name: 'guildAvailable',

  async execute(guild: Guild, client) {
    await Promise.resolve();
    initializeGuild(guild, client);
  },
};

export default event;
