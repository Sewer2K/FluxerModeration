import { EmbedBuilder } from '@fluxerjs/core';
import type { Command, BotShardInfo } from '@/types';
import { t } from '@/i18n';
import { getGatewayManager, getGatewayShardCount } from '@/utils/gatewayPing';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const command: Command = {
  name: 'shardinfo',
  description: 'Shows shard information (owner only)',
  category: 'owner',
  ownerOnly: true,

  async execute(message, _args, client) {
    try {
      const totalShardsEnv = process.env.TOTAL_SHARDS;
      const gateway = getGatewayManager(client);
      const totalShards = getGatewayShardCount(client) || (totalShardsEnv ? parseInt(totalShardsEnv, 10) : 1) || 1;
      const isSharded = totalShards > 1;

      const thisGuildId = message.guild?.id ?? message.guildId;
      let relevantShardIds: number[] = [];
      if (thisGuildId) {
        try {
          relevantShardIds = [Number((BigInt(thisGuildId) >> 22n) % BigInt(totalShards))];
        } catch {}
      } else if (isSharded) {
        relevantShardIds = process.env.SHARD_IDS
          ? process.env.SHARD_IDS.split(',')
              .map(Number)
              .filter((n) => !isNaN(n))
          : [...(gateway?.getShards?.()?.keys() ?? gateway?.shards?.keys() ?? [])];
      }

      let allShards: BotShardInfo[] = [];
      if (typeof client.fetchAllShardInfo === 'function') {
        try {
          allShards = await client.fetchAllShardInfo();
        } catch {}
      }
      if (!allShards.length) {
        allShards = [
          {
            workerId: 0,
            shardIds: [0],
            status: 'online',
            guilds: client.guilds.size,
            memory: +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
            uptime: Math.floor(process.uptime()),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ping: (client as any)._ws?.ping ?? null,
          },
        ];
      }

      let totalGuilds = 0;
      let totalMemory = 0;
      for (const s of allShards) {
        totalGuilds += s.guilds || 0;
        totalMemory += s.memory || 0;
      }

      const lines: string[] = [];
      for (const s of allShards) {
        const ids = (s.shardIds ?? []).join(', ');
        const marker = (s.shardIds ?? []).some((id: number) => relevantShardIds.includes(id)) ? ' **\u2190**' : '';
        lines.push(
          `Shard ${ids} \u2014 ${s.guilds ?? 0} guilds \u2022 ${s.memory ?? '?'} MB \u2022 ${formatUptime(s.uptime ?? 0)}${marker}`,
        );
      }

      const embed = new EmbedBuilder()
        .setTitle(t('en', 'auditCatalog.commands.owner.shardinfo.l66_setTitle'))
        .setDescription(
          `${totalShards} shards \u2022 ${totalGuilds} guilds \u2022 ${totalMemory.toFixed(1)} MB\n\n` +
            lines.join('\n'),
        )
        .setColor(0x5865f2);

      await message.reply({ embeds: [embed] });
    } catch (err) {
      console.error('[SHARDINFO] error:', err);
      try {
        await message.reply(t('en', 'auditCatalog.commands.owner.shardinfo.l76_reply'));
      } catch {}
    }
  },
};

export default command;
