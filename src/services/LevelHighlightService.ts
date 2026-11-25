import cron from 'node-cron';
import type { Client } from '@fluxerjs/core';
import { EmbedBuilder } from '@fluxerjs/core';
import GuildSettings from '@/models/GuildSettings';
import LevelProfile from '@/models/LevelProfile';
import { normalizeLevelingSettings } from '@/types/Leveling';
import log from '@/utils/consoleLogger';
import { isTextChannel } from '@/utils/isTextChannel';
import { messageFromError } from '@/utils/messageFromError';

let started = false;

async function postHighlight(
  client: Client,
  guildId: string,
  channelId: string,
  title: string,
  sortField: 'weeklyXp' | 'monthlyXp',
): Promise<void> {
  const top = await LevelProfile.getTop(guildId, 10, sortField);
  if (!top.length) return;

  const guild = client.guilds?.get(guildId);
  const channel = guild?.channels?.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
  if (!channel) return;

  const lines = top.map(
    (p, i) => `**${i + 1}.** <@${p.userId}> — level ${p.level} (${p[sortField] ?? 0} xp this period)`,
  );

  const embed = new EmbedBuilder().setTitle(title).setColor(0x6c72f8).setDescription(lines.join('\n'));
  if (!isTextChannel(channel)) return;
  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function syncFirstPlaceRoles(client: Client): Promise<void> {
  const guilds = await GuildSettings.find({ 'leveling.enabled': true, 'leveling.firstPlaceRoleId': { $ne: null } })
    .select('guildId leveling')
    .lean();

  for (const doc of guilds) {
    const leveling = normalizeLevelingSettings(doc.leveling);
    const roleId = leveling.firstPlaceRoleId;
    if (!roleId) continue;

    const top = await LevelProfile.getTop(doc.guildId, 1, 'xp');
    const winnerId = top[0]?.userId;
    if (!winnerId) continue;

    const guild = client.guilds?.get(doc.guildId);
    if (!guild) continue;

    let member = guild.members?.get(winnerId);
    if (!member) member = await guild.fetchMember?.(winnerId).catch(() => undefined);
    if (!member) continue;
    if (!member.roles?.roleIds?.includes(roleId)) {
      await member.roles.add(roleId).catch(() => {});
    }
  }
}

export function startLevelHighlightService(client: Client): void {
  if (started) return;
  started = true;

  cron.schedule('0 0 * * 0', async () => {
    try {
      const guilds = await GuildSettings.find({ 'leveling.highlights.weeklyEnabled': true })
        .select('guildId leveling')
        .lean();
      for (const doc of guilds) {
        const lv = normalizeLevelingSettings(doc.leveling);
        if (lv.highlights.weeklyChannelId) {
          await postHighlight(client, doc.guildId, lv.highlights.weeklyChannelId, 'Weekly XP Highlights', 'weeklyXp');
        }
      }
      await LevelProfile.updateMany({}, { $set: { weeklyXp: 0 } });
      log.info('Leveling', 'Weekly XP counters reset');
    } catch (err: unknown) {
      log.warn('Leveling', `Weekly highlight job failed: ${messageFromError(err)}`);
    }
  });

  cron.schedule('0 0 1 * *', async () => {
    try {
      const guilds = await GuildSettings.find({ 'leveling.highlights.monthlyEnabled': true })
        .select('guildId leveling')
        .lean();
      for (const doc of guilds) {
        const lv = normalizeLevelingSettings(doc.leveling);
        if (lv.highlights.monthlyChannelId) {
          await postHighlight(
            client,
            doc.guildId,
            lv.highlights.monthlyChannelId,
            'Monthly XP Highlights',
            'monthlyXp',
          );
        }
      }
      await LevelProfile.updateMany({}, { $set: { monthlyXp: 0 } });
      log.info('Leveling', 'Monthly XP counters reset');
    } catch (err: unknown) {
      log.warn('Leveling', `Monthly highlight job failed: ${messageFromError(err)}`);
    }
  });

  cron.schedule('0 * * * *', () => {
    syncFirstPlaceRoles(client).catch((err) => log.warn('Leveling', `First place role sync: ${err.message}`));
  });

  setInterval(async () => {
    try {
      const { tickVoiceXp } = await import('../utils/leveling');
      const guilds = await GuildSettings.find({ 'leveling.enabled': true, 'leveling.voiceXp.enabled': true })
        .select('guildId leveling')
        .lean();
      const map = new Map(guilds.map((g) => [g.guildId, { leveling: g.leveling }]));
      await tickVoiceXp(client, map);
    } catch {}
  }, 60_000);
}

export default { startLevelHighlightService };
