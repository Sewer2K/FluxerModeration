import { Router } from 'express';
import type { Client } from '@fluxerjs/core';
import Stat from '@/models/Stat';
import ModerationLog from '@/models/ModerationLog';
import { t } from '@/i18n';
import { resolveGuildName } from '../utils/resolveGuildName';
import statsService from '@/services/StatsService';
import * as memberCounter from '@/utils/memberCounter';
import config from '@/config';

function statsT(key: string, vars?: Record<string, string | number>): string {
  return t('en', `auditCatalog.api.routes.stats.${key}`, vars);
}

type InternalGuild = { id: string; name: string; icon: string | null; memberCount: number };

async function fetchBotGuilds(): Promise<InternalGuild[]> {
  const token = config.api.adminToken;
  const base = config.bot.internalUrl?.replace(/\/$/, '');
  if (!token || !base) return [];

  try {
    const res = await fetch(`${base}/internal/guilds`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { guilds?: InternalGuild[] };
    return data.guilds ?? [];
  } catch {
    return [];
  }
}

export function createStatsRouter(client: Client): Router {
  const router = Router();

  router.get('/totals', async (_req, res) => {
    try {
      const [commandCount, modActionCount] = await Promise.all([
        Stat.countDocuments({ type: 'command' }),
        ModerationLog.countDocuments(),
      ]);

      let totalGuilds = client.guilds?.size ?? 0;
      let totalMembers = 0;

      if (totalGuilds > 0) {
        for (const guildId of client.guilds?.keys() ?? []) {
          totalMembers += memberCounter.get(guildId) ?? 0;
        }
      } else {
        const remote = await fetchBotGuilds();
        if (remote.length > 0) {
          totalGuilds = remote.length;
          for (const g of remote) totalMembers += g.memberCount ?? 0;
        }
      }

      res.json({
        totalCommands: commandCount,
        totalModActions: modActionCount,
        totalGuilds,
        totalMembers,
      });
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/commands/daily', async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
      const daily = await Stat.aggregate([
        { $match: { type: 'command', createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      res.json(daily.map((d) => ({ date: d._id, count: d.count })));
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/commands/top', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    try {
      const top = await Stat.aggregate([
        { $match: { type: 'command' } },
        { $group: { _id: '$value', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]);

      res.json(top.map((t) => ({ command: t._id, count: t.count })));
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/guilds/top', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    try {
      const top = await Stat.aggregate([
        { $match: { type: 'command', 'additionalData.guildId': { $exists: true } } },
        { $group: { _id: '$additionalData.guildId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]);

      res.json(
        await Promise.all(
          top.map(async (row) => ({
            guildId: row._id,
            name: await resolveGuildName(client, row._id, statsT('unknownGuild', { guildId: row._id })),
            count: row.count,
          })),
        ),
      );
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/growth', async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);

    try {
      const growth = await statsService.getGuildGrowth(days);
      res.json(growth);
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/guilds/growth', async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);

    try {
      const result = await statsService.getDailyGuildEvents(days);
      res.json(result);
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/guilds/largest', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    try {
      let guilds: Array<{ guildId: string; name: string; members: number }>;

      if ((client.guilds?.size ?? 0) > 0) {
        guilds = [...(client.guilds?.entries() ?? [])].map(([guildId, guild]) => ({
          guildId,
          name: guild.name || guildId,
          members: memberCounter.get(guildId) ?? 0,
        }));
      } else {
        const remote = await fetchBotGuilds();
        guilds = remote.map((g) => ({
          guildId: g.id,
          name: g.name || g.id,
          members: g.memberCount ?? 0,
        }));
      }

      guilds.sort((a, b) => b.members - a.members);
      res.json(guilds.slice(0, limit));
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  return router;
}
