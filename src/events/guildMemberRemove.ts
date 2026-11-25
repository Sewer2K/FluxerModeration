import type { Client, GuildMember, PartialGuildMember } from '@fluxerjs/core';
import type { BotEvent } from '@/types';
import { type LogField, logServerEvent } from '@/utils/logger';
import * as memberCounter from '@/utils/memberCounter';
import settingsCache from '@/utils/settingsCache';
import sendGoodbye from '@/utils/sendGoodbye';
import LevelProfile from '@/models/LevelProfile';
import WelcomeMessageRecord from '@/models/WelcomeMessageRecord';
import { getLevelingConfig } from '@/utils/leveling';
import { messageFromError } from '@/utils/messageFromError';
import activityService from '@/services/ActivityService';

const event: BotEvent = {
  name: 'guildMemberRemove',

  async execute(member: GuildMember | PartialGuildMember, client: Client) {
    try {
      const guild = member.guild;
      if (!guild) return;

      const userId = member.id || member.user?.id;
      if (!userId) return;

      if (member.user?.bot !== true) activityService.recordMemberLeave(guild.id);

      try {
        const settings = await settingsCache.get(guild.id);
        const leveling = getLevelingConfig(settings);
        if (leveling.enabled && leveling.management.resetOnLeave) {
          await LevelProfile.deleteOne({ guildId: guild.id, userId });
        }
      } catch {}

      WelcomeMessageRecord.deleteOne({ guildId: guild.id, userId }).catch(() => {});

      const memberCount = memberCounter.decrement(guild.id);

      const leaveFields: LogField[] = [];
      if (memberCount) {
        leaveFields.push({ name: 'Members', value: memberCount.toLocaleString(), inline: true });
      }

      await logServerEvent(guild, 'Member Left', 0xe67e22, leaveFields, client, {
        description: `<@${userId}> left the server`,
        footer: `User ID: ${userId}`,
        eventType: 'member_leave',
      });

      try {
        const settings = await settingsCache.get(guild.id);
        if (settings) {
          await sendGoodbye(member, guild, settings, client);
        }
      } catch (err: unknown) {
        console.error(`[goodbye] Error sending goodbye in ${guild.name}: ${messageFromError(err)}`);
      }
    } catch (error) {
      console.error('Error in guildMemberRemove event:', error);
    }
  },
};

export default event;
