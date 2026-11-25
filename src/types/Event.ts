import type { ClientEventName, ClientEvents } from '@fluxerjs/core';
import type { BotClient } from './BotClient';

export type BotEvent = {
  [EventName in ClientEventName]: {
    name: EventName;
    once?: boolean;
    execute(...args: [...ClientEvents[EventName], BotClient]): void | Promise<void>;
  };
}[ClientEventName];
