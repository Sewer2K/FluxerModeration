export const DEFAULT_GUILDS_PER_SHARD = 1500;
export const MAX_GUILDS_PER_SHARD = 2500;

export interface ShardingOptions {
  shardCount: number | 'auto';
  guildsPerShard: number;
  shardIds?: number[];
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value?.trim() || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseShardIds(value: string | undefined): number[] | null {
  if (!value?.trim()) return null;

  const parts = value.split(',').map((part) => part.trim());
  if (parts.some((part) => !/^\d+$/.test(part))) return null;

  const ids = [...new Set(parts.map(Number))];
  return ids.length > 0 && ids.every((id) => Number.isSafeInteger(id) && id >= 0) ? ids.sort((a, b) => a - b) : null;
}

export function getShardingOptions(env: NodeJS.ProcessEnv = process.env): ShardingOptions {
  const explicitShardCount = env.TOTAL_SHARDS?.trim() === 'auto' ? null : parsePositiveInteger(env.TOTAL_SHARDS);
  const requestedGuildsPerShard = parsePositiveInteger(env.SHARD_GUILDS_PER_SHARD);
  const guildsPerShard = Math.min(requestedGuildsPerShard ?? DEFAULT_GUILDS_PER_SHARD, MAX_GUILDS_PER_SHARD);
  const shardIds = parseShardIds(env.SHARD_IDS);

  if (shardIds) {
    const workerShardCount = explicitShardCount ?? Math.max(...shardIds) + 1;
    if (shardIds.every((shardId) => shardId < workerShardCount)) {
      return { shardCount: workerShardCount, guildsPerShard, shardIds };
    }
  }

  return {
    shardCount: explicitShardCount ?? 'auto',
    guildsPerShard,
  };
}
