import { Router, type RequestHandler } from 'express';
import type { BotRuntime } from '../botRuntime';
import type { AuthRequest } from '../middleware/auth';

export function createBotRouter(runtime: BotRuntime, requireOwner: RequestHandler): Router {
  const router = Router();
  const client = runtime.client;
  const commandHandler = runtime.commandHandler;

  async function getGuildCount(): Promise<number> {
    if (typeof client.fetchTotalGuildCount === 'function') {
      return client.fetchTotalGuildCount();
    }
    return client.guilds?.size ?? 0;
  }

  router.get('/info', async (req: AuthRequest, res) => {
    const snapshot = runtime.getBotSnapshot();
    const online = runtime.isBotOnline();
    const base = {
      id: client.user?.id || snapshot?.userId || null,
      username: client.user?.username || snapshot?.username || null,
      avatar: client.user?.avatar || snapshot?.avatar || null,
      uptime: snapshot?.uptime ?? process.uptime(),
      readyAt: client.readyAt?.toISOString() || snapshot?.readyAt || null,
      online,
    };

    if (req.isOwner) {
      const guildCount = await getGuildCount();
      res.json({
        ...base,
        guilds: guildCount,
        memoryMB: +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
      });
    } else {
      res.json(base);
    }
  });

  router.get('/commands', (_req, res) => {
    if (!commandHandler) {
      res.status(503).json({ error: 'Command list unavailable while bot process is offline', code: 'BOT_OFFLINE' });
      return;
    }

    const categories = commandHandler.getCommandsByCategory();
    const result: Record<
      string,
      Array<{ name: string; description: string | string[]; usage?: string; permissions?: string[] }>
    > = {};

    for (const [category, commands] of Object.entries(categories)) {
      result[category] = commands.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        usage: cmd.usage,
        permissions: cmd.permissions,
      }));
    }

    res.json(result);
  });

  router.get('/guilds', requireOwner, async (_req, res) => {
    res.json({ count: await getGuildCount() });
  });

  return router;
}
