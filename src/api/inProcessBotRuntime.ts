import type { Client } from '@fluxerjs/core';
import type CommandHandler from '@/handlers/CommandHandler';
import { buildBotStatusSnapshot } from '@/internal/statusServer';
import type { BotRuntime } from './botRuntime';
import { snapshotToPublicStatus } from './botStatus';
import * as memberCounter from '@/utils/memberCounter';

export function createInProcessBotRuntime(client: Client, commandHandler: CommandHandler): BotRuntime {
  return {
    client,
    commandHandler,
    isBotOnline() {
      return buildBotStatusSnapshot(client).online;
    },
    getBotSnapshot() {
      return buildBotStatusSnapshot(client);
    },
    getGuildMemberCount(guildId: string) {
      return memberCounter.get(guildId);
    },
    async getPublicStatus() {
      return snapshotToPublicStatus(buildBotStatusSnapshot(client));
    },
    async refreshBotStatus() {},
    async start() {},
    async stop() {},
  };
}
