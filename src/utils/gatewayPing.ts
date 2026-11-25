import type { Client } from '@fluxerjs/core';

type GatewayShard = {
  ping?: number;
  _ping?: number;
  sessionId?: string | null;
};

type GatewayWs = {
  ping?: number;
  shards?: ReadonlyMap<number, GatewayShard>;
  getShardCount?: () => number;
  getShards?: () => ReadonlyMap<number, GatewayShard>;
};

export function getGatewayManager(client: Client): GatewayWs | null {
  return ((client as unknown as { _ws?: GatewayWs | null })._ws ?? null) as GatewayWs | null;
}

function averageShardPing(shards: ReadonlyMap<number, GatewayShard>): number {
  const values: number[] = [];
  for (const shard of shards.values()) {
    const ping = shard.ping ?? shard._ping ?? -1;
    if (ping >= 0) values.push(ping);
  }
  if (!values.length) return -1;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function getGatewayPing(client: Client): number | null {
  const ws = getGatewayManager(client);
  if (!ws) return null;

  const managerPing = ws.ping ?? -1;
  if (managerPing >= 0) return managerPing;

  const shardPing = ws.shards?.size ? averageShardPing(ws.shards) : -1;
  return shardPing >= 0 ? shardPing : null;
}

export function getGatewayShardCount(client: Client): number {
  const ws = getGatewayManager(client);
  const managerCount = ws?.getShardCount?.();
  if (typeof managerCount === 'number' && Number.isInteger(managerCount) && managerCount > 0) return managerCount;

  const shards = ws?.getShards?.() ?? ws?.shards;
  return shards?.size || 1;
}
