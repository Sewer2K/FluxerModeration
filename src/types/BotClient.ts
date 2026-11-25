import { Client } from '@fluxerjs/core';
import { ICommandHandler, IEventHandler } from './Command';
import { GatewayPresenceUpdateData } from '@fluxerjs/types';

export interface BotShardInfo {
  workerId: number;
  shardIds: number[];
  status: 'online' | 'offline';
  guilds: number;
  memory: number;
  uptime: number;
  ping: number | null;
}

export type BotPresence = GatewayPresenceUpdateData & {
  // future-proofed in preparation for FluxerJS v2
  [_ in 'custom_status' & keyof GatewayPresenceUpdateData]: NonNullable<GatewayPresenceUpdateData['custom_status']>;
};

export interface BotClientStats {
  guilds: number;
  members: number;
  memory: number;
  uptime: number;
}

export interface BotClient extends Client {
  commandHandler?: ICommandHandler;
  eventHandler?: IEventHandler;

  // callbacks
  fetchTotalGuildCount?: () => Promise<number>;
  fetchAllStats?: () => Promise<BotClientStats>;
  fetchAllShardInfo?: () => Promise<BotShardInfo[]>;
  fetchAllGuildIds?: () => Promise<Set<string>>;
  isGatewayRecovering?: () => boolean;
  isGatewayReplayActive?: () => boolean;

  // references
  readonly presenceRef?: BotPresence;
}
