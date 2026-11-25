import { Router } from 'express';
import type { BotRuntime } from '../botRuntime';
import settingsCache from '@/utils/settingsCache';
import BanAppeal from '@/models/BanAppeal';
import { verifyAppealToken } from '@/utils/appealToken';
import { normalizeAppealSettings, parseAppealAnswers, postAppealReview } from '@/utils/banAppeals';
import { appealSubmitIpLimiter, appealSubmitTokenLimiter } from '../middleware/rateLimit';
import { findGuildIdByLeaderboardSlug } from '@/utils/leveling/leaderboardVanity';
import { buildPublicLeaderboard, type LeaderboardPeriod } from '@/utils/leveling/publicLeaderboard';
import { fluxerPublicInstance, hydrateFluxerInstanceFromDiscovery } from '@/utils/fluxerUrls';

export function createPublicRouter(runtime: BotRuntime): Router {
  const router = Router();
  const client = runtime.client;

  async function guildName(guildId: string): Promise<string> {
    const cached = client.guilds.get(guildId);
    if (cached?.name) return cached.name;
    try {
      const fetched = await client.guilds.fetch(guildId);
      return fetched.name || guildId;
    } catch {
      return guildId;
    }
  }

  router.get('/appeal/:token', async (req, res) => {
    const payload = verifyAppealToken(String(req.params.token ?? ''));
    if (!payload) {
      res.status(404).json({ error: 'Appeal link is invalid or expired' });
      return;
    }

    const appeal = await BanAppeal.findLatest(payload.guildId, payload.userId);
    if (!appeal) {
      res.status(404).json({ error: 'Appeal not found' });
      return;
    }

    const settings = await settingsCache.get(payload.guildId).catch(() => null);
    const appeals = normalizeAppealSettings(settings?.appeals);
    res.json({
      guildName: await guildName(payload.guildId),
      banReason: appeal.banReason,
      caseNumber: appeal.caseNumber,
      eligible: appeals.enabled && appeal.eligible,
      state: appeal.state,
      nextEligibleAt: appeal.nextEligibleAt,
    });
  });

  router.post('/appeal/:token', appealSubmitIpLimiter, appealSubmitTokenLimiter, async (req, res) => {
    const payload = verifyAppealToken(String(req.params.token ?? ''));
    if (!payload) {
      res.status(404).json({ error: 'Appeal link is invalid or expired' });
      return;
    }

    const appeal = await BanAppeal.findLatest(payload.guildId, payload.userId);
    const settings = await settingsCache.get(payload.guildId).catch(() => null);
    const appeals = normalizeAppealSettings(settings?.appeals);
    if (!appeal || !appeal.eligible || !appeals.enabled) {
      res.status(403).json({ error: 'This ban is not eligible for an appeal' });
      return;
    }

    if (!req.body || typeof req.body !== 'object') {
      res.status(400).json({ error: 'Appeal answers are required' });
      return;
    }

    const parsed = parseAppealAnswers(req.body as Record<string, unknown>);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const now = new Date();
    const updated = await BanAppeal.findOneAndUpdate(
      {
        _id: appeal._id,
        guildId: payload.guildId,
        userId: payload.userId,
        eligible: true,
        state: { $nin: ['pending', 'blacklisted'] },
        $or: [{ nextEligibleAt: null }, { nextEligibleAt: { $lte: now } }],
      },
      {
        $set: {
          state: 'pending',
          submittedAt: now,
          decidedAt: null,
          decidedBy: null,
          staffReason: '',
          nextEligibleAt: null,
          answers: parsed.answers,
        },
        $push: {
          history: {
            at: now,
            by: payload.userId,
            action: 'submit',
            note: '',
          },
        },
      },
      { returnDocument: 'after' },
    );

    if (!updated) {
      const latest = await BanAppeal.findLatest(payload.guildId, payload.userId);
      if (latest?.state === 'pending') {
        res.status(409).json({ error: 'You already have a pending appeal' });
        return;
      }
      if (latest?.state === 'blacklisted') {
        res.status(403).json({ error: 'Further appeals are not available for this ban' });
        return;
      }
      if (latest?.nextEligibleAt && latest.nextEligibleAt > now) {
        res.status(429).json({ error: 'You cannot submit another appeal yet', nextEligibleAt: latest.nextEligibleAt });
        return;
      }
      res.status(409).json({ error: 'This appeal is no longer available' });
      return;
    }

    if (settings) {
      await postAppealReview(client, updated, settings).catch((error: unknown) => {
        console.warn(`[appeals] Failed to post review for ${payload.guildId}/${payload.userId}:`, error);
      });
    }

    res.status(201).json({ state: 'pending' });
  });

  router.get('/status', async (_req, res) => {
    const payload = await runtime.getPublicStatus();
    res.status(payload.online ? 200 : 503).json(payload);
  });

  router.get('/instance', async (_req, res) => {
    await hydrateFluxerInstanceFromDiscovery();
    res.json(fluxerPublicInstance());
  });

  router.get('/lb/:slug', async (req, res) => {
    try {
      const slug = String(req.params.slug ?? '').trim();
      if (!slug) {
        res.status(400).json({ error: 'Missing leaderboard slug' });
        return;
      }

      const guildId = await findGuildIdByLeaderboardSlug(slug);
      if (!guildId) {
        res.status(404).json({ error: 'Leaderboard not found' });
        return;
      }

      const periodRaw = typeof req.query.period === 'string' ? req.query.period : 'all';
      const period: LeaderboardPeriod = periodRaw === 'weekly' ? 'weekly' : periodRaw === 'monthly' ? 'monthly' : 'all';

      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 25;
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 25;

      const payload = await buildPublicLeaderboard(client, guildId, period, limit);
      if (!payload) {
        res.status(404).json({ error: 'Leveling is disabled for this server' });
        return;
      }

      res.json(payload);
    } catch {
      res.status(500).json({ error: 'Failed to load leaderboard' });
    }
  });

  return router;
}
