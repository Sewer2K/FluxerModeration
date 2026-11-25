import type { Client, GuildMember, Message, PermissionFlags } from '@fluxerjs/core';
import type { BotEvent } from './Event';
import type { BotClient } from './BotClient';

export interface ICommandHandler {
  client: Client;
  commands: Map<string, Command>;
  prefix: string;

  getPrefixes(guildId: string | null): Promise<string[]>;
  loadCommands(): Promise<void>;
  handleMessage(message: Message): Promise<void>;
  getMember(message: Message, options?: { refresh?: boolean }): Promise<GuildMember | null>;
  checkCooldown(userId: string, commandName: string): { ready: boolean; remaining: number };
  checkCustomCommandCooldown(
    userId: string,
    guildId: string,
    commandName: string,
    cooldownSeconds: number,
  ): { ready: boolean; remaining: number };
  getCommand(name: string): Command | undefined;
  getCommandsByCategory(): Record<string, Command[]>;
}

export interface IEventHandler {
  events: Map<string, BotEvent>;

  loadEvents(): Promise<void>;
  getEvent(name: string): BotEvent | undefined;
}

export interface Command {
  name: string;
  description: string | string[];
  usage?: string;
  category: string;
  aliases?: string[];
  permissions?: (keyof typeof PermissionFlags)[];
  cooldown?: number;
  ownerOnly?: boolean;
  allowDM?: boolean;
  hidden?: boolean;
  isAlias?: boolean;
  execute(message: Message, args: string[], client: BotClient, prefix?: string): Promise<void>;
}
