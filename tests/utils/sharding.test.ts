import { DEFAULT_GUILDS_PER_SHARD, MAX_GUILDS_PER_SHARD, getShardingOptions } from '@/utils/sharding';
import { isShardManagerWorker } from '@/utils/dmCoordinator';
import { getGatewayShardCount } from '@/utils/gatewayPing';

describe('sharding options', () => {
  test('uses automatic in-process sharding by default', () => {
    expect(getShardingOptions({})).toEqual({
      shardCount: 'auto',
      guildsPerShard: DEFAULT_GUILDS_PER_SHARD,
    });
  });

  test('preserves explicit process-worker shard assignments', () => {
    expect(
      getShardingOptions({
        TOTAL_SHARDS: '4',
        SHARD_IDS: '2, 3',
        SHARD_GUILDS_PER_SHARD: '2000',
      }),
    ).toEqual({
      shardCount: 4,
      guildsPerShard: 2000,
      shardIds: [2, 3],
    });
  });

  test('falls back to automatic mode for malformed worker assignments', () => {
    expect(getShardingOptions({ TOTAL_SHARDS: 'not-a-number', SHARD_IDS: '0,wat' })).toEqual({
      shardCount: 'auto',
      guildsPerShard: DEFAULT_GUILDS_PER_SHARD,
    });
  });

  test('caps the per-shard target at the gateway guild limit', () => {
    expect(getShardingOptions({ SHARD_GUILDS_PER_SHARD: '9999' }).guildsPerShard).toBe(MAX_GUILDS_PER_SHARD);
  });
});

describe('DM coordination mode', () => {
  test('does not treat a normal PM2 process as a shard-manager worker', () => {
    expect(isShardManagerWorker({})).toBe(false);
    expect(isShardManagerWorker({ NODE_APP_INSTANCE: '0' })).toBe(false);
  });

  test('recognizes workers launched by the shard manager', () => {
    expect(isShardManagerWorker({ CCM_SHARD_MANAGER_WORKER: '1' })).toBe(true);
  });
});

describe('gateway shard count', () => {
  test('uses the active manager shard count', () => {
    const client = { _ws: { getShardCount: () => 2 } } as never;
    expect(getGatewayShardCount(client)).toBe(2);
  });

  test('falls back to the active shard map when no manager count exists', () => {
    const client = {
      _ws: {
        getShards: () =>
          new Map([
            [0, {}],
            [1, {}],
          ]),
      },
    } as never;
    expect(getGatewayShardCount(client)).toBe(2);
  });
});
