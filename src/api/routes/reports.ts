import { randomUUID } from 'crypto';
import { Router, type RequestHandler } from 'express';
import type { BotClient } from '@/types';
import BugReport, { type BugReportDocument, type BugReportReply, type BugReportStatus } from '@/models/BugReport';
import { isArray } from '@/utils/isArray';
import { sendBugReportReply } from '../notifyBotBugReport';
import type { AuthRequest } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { fluxerApiUrl } from '@/utils/fluxerUrls';
import activityService from '@/services/ActivityService';

const REPORT_STATUSES: BugReportStatus[] = ['open', 'in_progress', 'resolved', 'closed'];
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_LINKS = 5;
const MAX_LINK_LENGTH = 2048;

interface UserGuild {
  id: string;
  name: string;
  icon: string | null;
}

interface FluxerUser {
  username: string;
  avatar: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !isArray(value);
}

function isBugReportStatus(value: unknown): value is BugReportStatus {
  return typeof value === 'string' && REPORT_STATUSES.includes(value as BugReportStatus);
}

function requestBody(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

async function fetchUserGuilds(token: string): Promise<UserGuild[] | null> {
  const response = await fetch(fluxerApiUrl('/users/@me/guilds'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;

  const body: unknown = await response.json();
  if (!isArray(body)) return null;

  return body.flatMap((guild): UserGuild[] => {
    if (!isRecord(guild) || typeof guild.id !== 'string' || typeof guild.name !== 'string') return [];
    return [
      {
        id: guild.id,
        name: guild.name,
        icon: typeof guild.icon === 'string' ? guild.icon : null,
      },
    ];
  });
}

async function fetchFluxerUser(token: string, fallbackId: string): Promise<FluxerUser> {
  try {
    const response = await fetch(fluxerApiUrl('/users/@me'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const body: unknown = await response.json();
      if (isRecord(body)) {
        return {
          username: typeof body.username === 'string' && body.username.trim() ? body.username.trim() : fallbackId,
          avatar: typeof body.avatar === 'string' ? body.avatar : null,
        };
      }
    }
  } catch {}

  return { username: fallbackId, avatar: null };
}

async function fetchBotGuildIds(client: BotClient): Promise<Set<string>> {
  if (client.fetchAllGuildIds) return client.fetchAllGuildIds();
  return new Set(client.guilds.keys());
}

export function parseBugReportLinks(value: unknown): { links: string[] } | { error: string } {
  const rawLinks =
    typeof value === 'string'
      ? value.split(/\r?\n/)
      : isArray(value)
        ? value.map((link) => (typeof link === 'string' ? link : ''))
        : [];
  const links = [...new Set(rawLinks.map((link) => link.trim()).filter(Boolean))];

  if (links.length > MAX_LINKS) {
    return { error: `Add no more than ${MAX_LINKS} links` };
  }

  for (const link of links) {
    if (link.length > MAX_LINK_LENGTH) return { error: 'Each link must be 2048 characters or shorter' };
    try {
      const url = new URL(link);
      if (url.protocol !== 'https:') return { error: 'Links must use HTTPS' };
    } catch {
      return { error: `Invalid link: ${link}` };
    }
  }

  return { links };
}

function reportIdParam(req: AuthRequest): string | null {
  const id = req.params.id;
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id) ? id : null;
}

function serializeReport(report: BugReportDocument): Record<string, unknown> {
  return report.toObject() as unknown as Record<string, unknown>;
}

async function deliverReply(report: BugReportDocument, reply: BugReportReply): Promise<void> {
  const result = await sendBugReportReply(report.reporterId, String(report._id), reply.message);
  if (result.ok) {
    reply.deliveryStatus = 'sent';
    reply.deliveryError = null;
    reply.deliveredAt = new Date();
  } else {
    reply.deliveryStatus = 'failed';
    reply.deliveryError = result.error;
    reply.deliveredAt = null;
  }
  await report.save();
}

export function createReportsRouter(client: BotClient, requireOwner: RequestHandler): Router {
  const router = Router();

  router.get('/context', async (req: AuthRequest, res) => {
    const token = req.fluxerToken;
    if (!token) {
      res.status(403).json({ error: 'Bug report server context requires Fluxer OAuth' });
      return;
    }

    try {
      const [userGuilds, botGuildIds] = await Promise.all([fetchUserGuilds(token), fetchBotGuildIds(client)]);
      if (!userGuilds) {
        res.status(502).json({ error: 'Could not load your Fluxer servers' });
        return;
      }

      res.json(userGuilds.filter((guild) => botGuildIds.has(guild.id)).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      res.status(502).json({ error: 'Could not load your Fluxer servers' });
    }
  });

  router.post('/', writeLimiter, async (req: AuthRequest, res) => {
    const token = req.fluxerToken;
    const reporterId = req.userId;
    if (!token || !reporterId) {
      res.status(403).json({ error: 'Submitting a bug report requires Fluxer OAuth' });
      return;
    }

    const body = requestBody(req.body);
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const guildId = typeof body.guildId === 'string' ? body.guildId.trim() : '';
    if (description.length < 10) {
      res.status(400).json({ error: 'Describe the problem in at least 10 characters' });
      return;
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      res.status(400).json({ error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or shorter` });
      return;
    }
    if (!guildId) {
      res.status(400).json({ error: 'Choose the affected server' });
      return;
    }

    const parsedLinks = parseBugReportLinks(body.links);
    if ('error' in parsedLinks) {
      res.status(400).json({ error: parsedLinks.error });
      return;
    }

    try {
      const [userGuilds, botGuildIds, user] = await Promise.all([
        fetchUserGuilds(token),
        fetchBotGuildIds(client),
        fetchFluxerUser(token, reporterId),
      ]);
      const guild = userGuilds?.find((candidate) => candidate.id === guildId);
      if (!guild || !botGuildIds.has(guildId)) {
        res.status(400).json({ error: 'Choose a server where the bot is present' });
        return;
      }

      const report = await BugReport.create({
        reporterId,
        reporterUsername: user.username,
        reporterAvatar: user.avatar,
        guildId: guild.id,
        guildName: guild.name,
        description,
        links: parsedLinks.links,
      });
      activityService.recordReport(guild.id);

      res.status(201).json(serializeReport(report));
    } catch {
      res.status(500).json({ error: 'Failed to save bug report' });
    }
  });

  router.get('/', requireOwner, async (req, res) => {
    try {
      const statusParam = typeof req.query.status === 'string' ? req.query.status : null;
      if (statusParam && !isBugReportStatus(statusParam)) {
        res.status(400).json({ error: 'Invalid report status' });
        return;
      }

      const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 50;
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
      const filter: { status?: BugReportStatus } = statusParam ? { status: statusParam as BugReportStatus } : {};
      const [reports, total] = await Promise.all([
        BugReport.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
        BugReport.countDocuments(filter),
      ]);
      res.json({ reports, total });
    } catch {
      res.status(500).json({ error: 'Failed to load bug reports' });
    }
  });

  router.get('/:id', requireOwner, async (req, res) => {
    const id = reportIdParam(req);
    if (!id) {
      res.status(400).json({ error: 'Invalid bug report ID' });
      return;
    }

    try {
      const report = await BugReport.findById(id).lean();
      if (!report) {
        res.status(404).json({ error: 'Bug report not found' });
        return;
      }
      res.json(report);
    } catch {
      res.status(500).json({ error: 'Failed to load bug report' });
    }
  });

  router.patch('/:id', requireOwner, writeLimiter, async (req, res) => {
    const id = reportIdParam(req);
    if (!id) {
      res.status(400).json({ error: 'Invalid bug report ID' });
      return;
    }

    const status = requestBody(req.body).status;
    if (!isBugReportStatus(status)) {
      res.status(400).json({ error: 'Choose a valid report status' });
      return;
    }

    try {
      const report = await BugReport.findByIdAndUpdate(id, { $set: { status } }, { new: true }).lean();
      if (!report) {
        res.status(404).json({ error: 'Bug report not found' });
        return;
      }
      res.json(report);
    } catch {
      res.status(500).json({ error: 'Failed to update bug report' });
    }
  });

  router.post('/:id/replies', requireOwner, writeLimiter, async (req: AuthRequest, res) => {
    const id = reportIdParam(req);
    if (!id) {
      res.status(400).json({ error: 'Invalid bug report ID' });
      return;
    }

    const body = requestBody(req.body);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 4000) {
      res.status(400).json({ error: 'Reply must be between 1 and 4000 characters' });
      return;
    }

    try {
      const report = await BugReport.findById(id);
      if (!report) {
        res.status(404).json({ error: 'Bug report not found' });
        return;
      }

      const reply: BugReportReply = {
        replyId: randomUUID(),
        authorId: req.userId ?? 'owner',
        message,
        deliveryStatus: 'pending',
        deliveryError: null,
        createdAt: new Date(),
        deliveredAt: null,
      };
      report.replies.push(reply);
      await report.save();
      await deliverReply(report, report.replies[report.replies.length - 1]!);

      res.status(201).json({
        report: serializeReport(report),
        deliveryStatus: report.replies[report.replies.length - 1]!.deliveryStatus,
      });
    } catch {
      res.status(500).json({ error: 'Failed to send bug report reply' });
    }
  });

  router.post('/:id/replies/:replyId/retry', requireOwner, writeLimiter, async (req, res) => {
    const id = reportIdParam(req);
    const replyId = typeof req.params.replyId === 'string' ? req.params.replyId : '';
    if (!id || !replyId) {
      res.status(400).json({ error: 'Invalid bug report reply ID' });
      return;
    }

    try {
      const report = await BugReport.findById(id);
      const reply = report?.replies.find((candidate) => candidate.replyId === replyId);
      if (!report || !reply) {
        res.status(404).json({ error: 'Bug report reply not found' });
        return;
      }
      if (reply.deliveryStatus === 'sent') {
        res.status(400).json({ error: 'That reply was already delivered' });
        return;
      }

      reply.deliveryStatus = 'pending';
      reply.deliveryError = null;
      await deliverReply(report, reply);
      res.json({
        report: serializeReport(report),
        deliveryStatus: reply.deliveryStatus,
      });
    } catch {
      res.status(500).json({ error: 'Failed to retry bug report reply' });
    }
  });

  return router;
}
