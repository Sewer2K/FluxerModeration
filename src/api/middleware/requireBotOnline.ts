import type { RequestHandler } from 'express';
import type { BotRuntime } from '../botRuntime';

export function createRequireBotOnline(runtime: BotRuntime): RequestHandler {
  return (_req, res, next) => {
    if (runtime.isBotOnline()) {
      next();
      return;
    }
    res.status(503).json({
      error:
        'Bot is currently offline. Live actions are unavailable until the bot reconnects. Settings can still be saved.',
      code: 'BOT_OFFLINE',
    });
  };
}
