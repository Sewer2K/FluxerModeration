import { Router, type RequestHandler } from 'express';
import type { Client } from '@fluxerjs/core';
import type { APIChannel } from '@fluxerjs/types';
import { Routes } from '@fluxerjs/types';
import type { AuthRequest } from '../middleware/auth';
import type { BotRuntime } from '../botRuntime';
import ModerationLog from '@/models/ModerationLog';
import LevelProfile from '@/models/LevelProfile';
import statsService from '@/services/StatsService';
import activityService from '@/services/ActivityService';
import { t } from '@/i18n';
import { isArray } from '@/utils/isArray';

function internalError(res: Parameters<RequestHandler>[1]): void {
  res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
}

function parseDays(raw: unknown, fallback = 30, max = 365): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), max) : fallback;
}

function parseLimit(raw: unknown, fallback = 10, max = 50): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), max) : fallback;
}

async function resolveLevelingUsername(client: Client, userId: string): Promise<string> {
  const user = client.users.get(userId) ?? (await client.users.fetch(userId).catch(() => null));
  return user?.globalName || user?.username || userId;
}

async function resolveChannelNames(client: Client, guildId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const guild = client.guilds.get(guildId);

  for (const channel of guild?.channels?.values() ?? []) {
    if (channel.name) names.set(channel.id, channel.name);
  }

  try {
    const raw = (await client.rest.get(Routes.guildChannels(guildId))) as APIChannel[] | Record<string, APIChannel>;
    const channels = isArray(raw) ? raw : Object.values(raw);
    for (const channel of channels) {
      if (channel.id && channel.name) names.set(channel.id, channel.name);
    }
  } catch {}

  return names;
}

export function createAnalyticsRouter(runtime: BotRuntime, requireGuildAccess: RequestHandler): Router {
  const router = Router();
  const client = runtime.client;

  // ---------- summary ----------
  router.get('/:id/analytics/summary', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;

    try {
      const [commandCount, modActionCount, levelingStats] = await Promise.all([
        statsService.getGuildCommandCount(guildId),
        ModerationLog.countDocuments({ guildId }),
        LevelProfile.aggregate<{ profiles: number; messages: number; avgLevel: number }>([
          { $match: { guildId } },
          {
            $group: {
              _id: null,
              profiles: { $sum: 1 },
              messages: { $sum: '$messages' },
              avgLevel: { $avg: '$level' },
            },
          },
        ]),
      ]);

      const leveling = levelingStats[0] ?? { profiles: 0, messages: 0, avgLevel: 0 };
      const members =
        runtime.getGuildMemberCount(guildId) ?? (await statsService.getLatestGuildMemberCount(guildId)) ?? 0;

      const guild = client.guilds.get(guildId);

      res.json({
        guildName: guild?.name ?? guildId,
        members,
        totalCommands: commandCount,
        totalModActions: modActionCount,
        levelingProfiles: leveling.profiles,
        levelingMessages: leveling.messages,
        avgLevel: Math.round(leveling.avgLevel * 10) / 10,
      });
    } catch {
      internalError(res);
    }
  });

  router.get('/:id/analytics/activity/daily', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const days = parseDays(req.query.days);

    try {
      res.json(await activityService.getDaily(guildId, days));
    } catch {
      internalError(res);
    }
  });

  router.get('/:id/analytics/activity/summary', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const days = parseDays(req.query.days);

    try {
      res.json(await activityService.getSummary(guildId, days));
    } catch {
      internalError(res);
    }
  });

  router.get('/:id/analytics/activity/channels', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const days = parseDays(req.query.days);
    const limit = parseLimit(req.query.limit);

    try {
      const top = await activityService.getTopChannels(guildId, days, limit);
      const channelNames = await resolveChannelNames(client, guildId);
      res.json(
        top.map((channel) => ({
          ...channel,
          channelName: channelNames.get(channel.channelId) ?? null,
        })),
      );
    } catch {
      internalError(res);
    }
  });

  router.get('/:id/analytics/activity/heatmap', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const days = parseDays(req.query.days);

    try {
      res.json(await activityService.getHeatmap(guildId, days));
    } catch {
      internalError(res);
    }
  });

  // ---------- command usage over time ----------
  router.get('/:id/analytics/commands/daily', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const days = parseDays(req.query.days);

    try {
      const daily = await statsService.getGuildCommandsDaily(guildId, days);
      res.json(daily);
    } catch {
      internalError(res);
    }
  });

  // ---------- top commands ----------
  router.get('/:id/analytics/commands/top', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const limit = parseLimit(req.query.limit);

    try {
      const top = await statsService.getGuildTopCommands(guildId, limit);
      res.json(top);
    } catch {
      internalError(res);
    }
  });

  // ---------- moderation daily breakdown ----------
  router.get('/:id/analytics/moderation/daily', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const days = parseDays(req.query.days);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
      const rows = await ModerationLog.aggregate<{
        _id: { date: string; action: string };
        count: number;
      }>([
        { $match: { guildId, timestamp: { $gte: since } } },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
              action: '$action',
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.date': 1 } },
      ]);

      const byDate = new Map<string, Record<string, number>>();
      for (const row of rows) {
        const entry = byDate.get(row._id.date) ?? {};
        entry[row._id.action] = row.count;
        byDate.set(row._id.date, entry);
      }

      const daily = [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, actions]) => {
          const total = Object.values(actions).reduce((s, n) => s + n, 0);
          return { date, total, ...actions };
        });

      res.json(daily);
    } catch {
      internalError(res);
    }
  });

  // ---------- moderation action breakdown ----------
  router.get('/:id/analytics/moderation/breakdown', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const days = parseDays(req.query.days);

    try {
      const stats = await ModerationLog.getGuildStats(guildId, days);
      res.json(stats);
    } catch {
      internalError(res);
    }
  });

  // ---------- member trend ----------
  router.get('/:id/analytics/members/trend', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const days = parseDays(req.query.days);

    try {
      const trend = await statsService.getGuildMemberTrend(guildId, days);
      const currentMembers = runtime.getGuildMemberCount(guildId);
      if (currentMembers !== null) {
        const today = new Date().toISOString().slice(0, 10);
        const latest = trend[trend.length - 1];
        if (latest?.date === today) {
          latest.members = currentMembers;
        } else {
          trend.push({ date: today, members: currentMembers });
        }
      }
      res.json(trend);
    } catch {
      internalError(res);
    }
  });

  // ---------- leveling top ----------
  router.get('/:id/analytics/leveling/top', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const limit = parseLimit(req.query.limit);

    try {
      const top = await LevelProfile.getTop(guildId, limit);
      const entries = await Promise.all(
        top.map(async (p) => ({
          userId: p.userId,
          username: await resolveLevelingUsername(client, p.userId),
          xp: p.xp,
          level: p.level,
          messages: p.messages,
        })),
      );
      res.json(entries);
    } catch {
      internalError(res);
    }
  });

  // ---------- CSV export ----------
  router.get('/:id/analytics/export', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const days = parseDays(req.query.days, 30, 365);

    try {
      const [commandsDaily, topCommands, modStats, memberTrend, topLeveling] = await Promise.all([
        statsService.getGuildCommandsDaily(guildId, days),
        statsService.getGuildTopCommands(guildId, 25),
        ModerationLog.getGuildStats(guildId, days),
        statsService.getGuildMemberTrend(guildId, days),
        LevelProfile.getTop(guildId, 25),
      ]);

      const lines: string[] = [];
      const guild = client.guilds.get(guildId);
      const guildName = guild?.name ?? guildId;
      const exportDate = new Date().toISOString().slice(0, 10);

      lines.push(`# Server Analytics Export`);
      lines.push(`# Server: ${guildName}`);
      lines.push(`# Period: ${days} days`);
      lines.push(`# Exported: ${exportDate}`);
      lines.push('');

      // commands daily
      lines.push('## Daily Command Usage');
      lines.push('date,commands');
      for (const row of commandsDaily) {
        lines.push(`${row.date},${row.count}`);
      }
      lines.push('');

      // top commands
      lines.push('## Top Commands');
      lines.push('command,uses');
      for (const row of topCommands) {
        // escape commas in command names (custom commands can have them)
        const safe = row.command.includes(',') ? `"${row.command}"` : row.command;
        lines.push(`${safe},${row.count}`);
      }
      lines.push('');

      // moderation breakdown
      lines.push('## Moderation Actions');
      lines.push('action,count');
      for (const [action, count] of Object.entries(modStats.byAction)) {
        lines.push(`${action},${count}`);
      }
      lines.push(`total,${modStats.total}`);
      lines.push('');

      // member trend
      if (memberTrend.length > 0) {
        lines.push('## Daily Member Count');
        lines.push('date,members');
        for (const row of memberTrend) {
          lines.push(`${row.date},${row.members}`);
        }
        lines.push('');
      }

      // leveling top
      if (topLeveling.length > 0) {
        lines.push('## Top Members (Leveling)');
        lines.push('user_id,level,xp,messages');
        for (const row of topLeveling) {
          lines.push(`${row.userId},${row.level},${row.xp},${row.messages}`);
        }
      }

      const safeName = guildName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
      const filename = `analytics_${safeName}_${exportDate}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(lines.join('\n'));
    } catch {
      internalError(res);
    }
  });

  return router;
}
