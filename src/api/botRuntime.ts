import type CommandHandler from '@/handlers/CommandHandler';
import type { BotStatusSnapshot, PublicStatusPayload } from './botStatus';
import type { BotClient } from '@/types';

export interface BotRuntime {
  readonly client: BotClient;
  readonly commandHandler: CommandHandler | null;
  isBotOnline(): boolean;
  getPublicStatus(): Promise<PublicStatusPayload>;
  getBotSnapshot(): BotStatusSnapshot | null;
  getGuildMemberCount(guildId: string): number | null;
  refreshBotStatus(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
