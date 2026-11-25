import type { Guild } from '@fluxerjs/core';
import type { BotEvent } from '@/types';
import log from '@/utils/consoleLogger';
import statsService from '@/services/StatsService';
import { forgetInitializedGuild } from './guildCreate';

const event: BotEvent = {
  name: 'guildDelete',

  async execute(guild: Guild) {
    try {
      log.warn('Guild', `Left guild: ${guild.name || 'Unknown'} (${guild.id})`);
      forgetInitializedGuild(guild.id);
      statsService.recordGuildLeave(guild.id, guild.name || guild.id).catch(() => {});
    } catch (error) {
      console.error('Error in guildDelete event:', error);
    }
  },
};

export default event;
