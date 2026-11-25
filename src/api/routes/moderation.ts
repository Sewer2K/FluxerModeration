import { Router, type RequestHandler } from 'express';
import type { AuthRequest } from '../middleware/auth';
import ModerationLog from '@/models/ModerationLog';
import BanAppeal from '@/models/BanAppeal';
import Warning from '@/models/Warning';
import { t } from '@/i18n';
import { isInUnion } from '@/utils/isInUnion';
import { MODERATION_ACTIONS, type BanAppealState } from '@/types';

const BAN_APPEAL_STATES = ['none', 'pending', 'approved', 'denied', 'dismissed', 'blacklisted'] as const;

function moderationT(key: string): string {
  return t('en', `auditCatalog.api.routes.moderation.${key}`);
}

function safeStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function createModerationRouter(requireGuildAccess: RequestHandler): Router {
  const router = Router();

  router.get('/:guildId/appeals', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const guildId = typeof req.params.guildId === 'string' ? req.params.guildId : '';
      const state = safeStr(req.query.state);
      const userId = safeStr(req.query.userId);
      const limitValue = safeStr(req.query.limit);
      const limit = Math.min(Math.max(parseInt(limitValue || '50', 10) || 50, 1), 100);
      const query: { guildId: string; state?: BanAppealState; userId?: string } = { guildId };
      if (state && isInUnion(state, BAN_APPEAL_STATES)) query.state = state;
      if (userId) query.userId = userId;

      const appeals = await BanAppeal.find(query).sort({ submittedAt: -1 }).limit(limit).lean();
      res.json({ appeals });
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/:guildId/appeals/:userId', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const guildId = typeof req.params.guildId === 'string' ? req.params.guildId : '';
      const userId = typeof req.params.userId === 'string' ? req.params.userId : '';
      const appeal = await BanAppeal.findLatest(guildId, userId);
      if (!appeal) {
        res.status(404).json({ error: 'Appeal not found' });
        return;
      }
      res.json(appeal);
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/:guildId/logs', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const { guildId: guildIdParam } = req.params;
      const { limit: limitQuery, skip: skipQuery, action: actionQuery, userId, targetId } = req.query;
      if (!guildIdParam || typeof guildIdParam !== 'string') {
        res.status(400);
        return;
      }

      const action = safeStr(actionQuery);
      const limit = safeStr(limitQuery);
      const skip = safeStr(skipQuery);

      const logs = await ModerationLog.getGuildLogs(guildIdParam, {
        limit: Math.min((limit && parseInt(limit)) || 50, 100),
        skip: (skip && parseInt(skip)) || 0,
        action: isInUnion(action, MODERATION_ACTIONS) ? action : undefined,
        userId: safeStr(userId),
        targetId: safeStr(targetId),
      });

      const total = await ModerationLog.countDocuments({ guildId: guildIdParam });

      res.json({ logs, total });
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/:guildId/logs/:caseNumber', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const { caseNumber: caseNumberParam, guildId: guildIdParam } = req.params;

      const caseNumber = typeof caseNumberParam === 'string' ? parseInt(caseNumberParam) : NaN;
      if (isNaN(caseNumber)) {
        res.status(400).json({ error: moderationT('invalidCaseNumber') });
        return;
      }

      const log = typeof guildIdParam === 'string' ? await ModerationLog.getCase(guildIdParam, caseNumber) : null;
      if (!log) {
        res.status(404).json({ error: moderationT('caseNotFound') });
        return;
      }

      res.json(log);
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/:guildId/stats', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const { days: daysQuery, guildId: guildIdQuery } = req.query;
      if ((daysQuery && typeof daysQuery !== 'string') || !guildIdQuery || typeof guildIdQuery !== 'string') {
        res.status(400);
        return;
      }

      const days = Math.min((daysQuery && parseInt(daysQuery)) || 30, 365);
      const stats = await ModerationLog.getGuildStats(guildIdQuery, days);
      res.json(stats);
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/:guildId/warnings/:userId', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const { userId: userIdParam, guildId: guildIdParam } = req.params;
      if (!userIdParam || typeof userIdParam !== 'string' || !guildIdParam || typeof guildIdParam !== 'string') {
        res.status(400);
        return;
      }

      const record = await Warning.getUserWarnings(guildIdParam, userIdParam);
      res.json({
        userId: userIdParam,
        guildId: guildIdParam,
        warnings: record.warnings,
        activeCount: record.getActiveCount(),
      });
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/:guildId/user/:userId/history', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const { userId: userIdQuery, guildId: guildIdQuery, limit: limitQuery } = req.query;
      if (
        (limitQuery && typeof limitQuery !== 'string') ||
        !userIdQuery ||
        typeof userIdQuery !== 'string' ||
        !guildIdQuery ||
        typeof guildIdQuery !== 'string'
      ) {
        res.status(400);
        return;
      }

      const limit = Math.min((limitQuery && parseInt(limitQuery)) || 20, 100);
      const history = await ModerationLog.getUserHistory(guildIdQuery, userIdQuery, limit);
      res.json(history);
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  return router;
}
