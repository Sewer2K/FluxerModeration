import fs from 'fs';
import path from 'path';
import * as GlitchTip from '@sentry/node';
import type { BotClient, BotEvent, IEventHandler } from '@/types';
import { messageFromError } from '@/utils/messageFromError';

export default class EventHandler implements IEventHandler {
  events = new Map<string, BotEvent>();

  constructor(public client: BotClient) {}

  async loadEvents(): Promise<void> {
    const eventsPath = path.join(__dirname, '..', 'events');

    if (!fs.existsSync(eventsPath)) {
      console.warn('Events directory not found, creating...');
      fs.mkdirSync(eventsPath, { recursive: true });
      return;
    }

    const eventFiles = fs
      .readdirSync(eventsPath)
      .filter(
        (file) =>
          (file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts') && !/^index\.(ts|js)$/.test(file),
      );

    for (const file of eventFiles) {
      try {
        const eventPath = path.join(eventsPath, file);
        const imported = require(eventPath);
        const event: BotEvent = imported.default || imported;

        if (!event.name) {
          console.warn(`Event in ${file} is missing a name, skipping...`);
          continue;
        }

        if (event.once) {
          this.client.once(event.name, (...args: unknown[]) => {
            try {
              // there's no way to reasonably handle for all the values of the distributed union that `args` could be here
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const result = (event.execute as any)(...args, this.client);
              if (result && typeof result.catch === 'function') {
                result.catch((err: Error) => {
                  GlitchTip.captureException(err, { tags: { event: event.name } });
                  console.error(`[GlitchTip] Unhandled error in event ${event.name}:`, err);
                });
              }
            } catch (err) {
              GlitchTip.captureException(err, { tags: { event: event.name } });
              console.error(`[GlitchTip] Unhandled error in event ${event.name}:`, err);
            }
          });
        } else {
          this.client.on(event.name, (...args: unknown[]) => {
            try {
              // there's no way to reasonably handle for all the values of the distributed union that `args` could be here
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const result = (event.execute as any)(...args, this.client);
              if (result && typeof result.catch === 'function') {
                result.catch((err: Error) => {
                  GlitchTip.captureException(err, { tags: { event: event.name } });
                  console.error(`[GlitchTip] Unhandled error in event ${event.name}:`, err);
                });
              }
            } catch (err) {
              GlitchTip.captureException(err, { tags: { event: event.name } });
              console.error(`[GlitchTip] Unhandled error in event ${event.name}:`, err);
            }
          });
        }

        this.events.set(event.name, event);
      } catch (error: unknown) {
        console.error(`Error loading event ${file}:`, messageFromError(error));
      }
    }
  }

  getEvent(name: string): BotEvent | undefined {
    return this.events.get(name);
  }
}
