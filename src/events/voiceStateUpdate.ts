import type { Client } from '@fluxerjs/core';
import type { GatewayVoiceStateUpdateDispatchData } from '@fluxerjs/types';
import type { BotEvent } from '@/types';
import { logServerEvent } from '@/utils/logger';
import { updateVoiceSession } from '@/utils/leveling';
import activityService from '@/services/ActivityService';

// good ENOUGH for now, will optimize later if needed
const voiceCache = new Map<string, string>();
const voiceStartTimes = new Map<string, number>();

const event: BotEvent = {
  name: 'voiceStateUpdate',

  async execute(data: GatewayVoiceStateUpdateDispatchData, client: Client) {
    try {
      if (!data.guild_id) return;

      if (data.member?.user?.bot) return;

      const guild = client.guilds.get(data.guild_id);
      if (!guild) return;

      const userId = data.user_id;
      if (!userId) return;

      const voiceKey = `${data.guild_id}:${userId}`;
      const prevChannelId = voiceCache.get(voiceKey) ?? null;
      const currChannelId = data.channel_id ?? null;
      const now = Date.now();

      if (currChannelId) {
        voiceCache.set(voiceKey, currChannelId);
        if (!prevChannelId) {
          voiceStartTimes.set(voiceKey, now);
          activityService.recordVoiceJoin(data.guild_id);
        } else if (prevChannelId !== currChannelId) {
          const startedAt = voiceStartTimes.get(voiceKey);
          if (startedAt) activityService.recordVoiceMinutes(data.guild_id, (now - startedAt) / 60000);
          voiceStartTimes.set(voiceKey, now);
        }
      } else {
        voiceCache.delete(voiceKey);
        const startedAt = voiceStartTimes.get(voiceKey);
        if (startedAt) activityService.recordVoiceMinutes(data.guild_id, (now - startedAt) / 60000);
        voiceStartTimes.delete(voiceKey);
      }

      updateVoiceSession(data.guild_id, userId, {
        channelId: currChannelId,
        selfMute: !!data.self_mute,
        selfDeaf: !!data.self_deaf,
        serverMute: !!data.mute,
        serverDeaf: !!data.deaf,
      });

      if (!prevChannelId && currChannelId) {
        await logServerEvent(
          guild,
          'Joined Voice',
          0x2ecc71,
          [{ name: 'Channel', value: `<#${currChannelId}>`, inline: true }],
          client,
          { description: `<@${userId}> joined a voice channel`, footer: `User ID: ${userId}`, eventType: 'voice_join' },
        );
      } else if (prevChannelId && !currChannelId) {
        await logServerEvent(
          guild,
          'Left Voice',
          0xe67e22,
          [{ name: 'Channel', value: `<#${prevChannelId}>`, inline: true }],
          client,
          { description: `<@${userId}> left a voice channel`, footer: `User ID: ${userId}`, eventType: 'voice_leave' },
        );
      } else if (prevChannelId && currChannelId && prevChannelId !== currChannelId) {
        await logServerEvent(
          guild,
          'Moved Voice Channel',
          0x3498db,
          [
            { name: 'From', value: `<#${prevChannelId}>`, inline: true },
            { name: 'To', value: `<#${currChannelId}>`, inline: true },
          ],
          client,
          { description: `<@${userId}> moved voice channels`, footer: `User ID: ${userId}`, eventType: 'voice_move' },
        );
      }
    } catch (error) {
      console.error('Error in voiceStateUpdate event:', error);
    }
  },
};

export default event;
