import type { Request, Response, NextFunction } from 'express';
import type { Client } from '@fluxerjs/core';
import crypto from 'crypto';
import mongoose from 'mongoose';
import config from '@/config';
import ServiceBlock from '@/models/ServiceBlock';
import { terminationNotice } from '@/utils/serviceBlockCache';
import { t } from '@/i18n';
import { fluxerApiUrl } from '@/utils/fluxerUrls';
import { canAccessDashboard, isGuildAllowed } from '@/utils/accessControl';

const tokenCache = new Map<string, { userId: string; expiresAt: number }>();
const TOKEN_CACHE_TTL = 10 * 60 * 1000;
const MAX_CACHE_SIZE = 1000;

function authT(key: string): string {
  return t('en', `auditCatalog.api.middleware.auth.${key}`);
}

setInterval(
  () => {
    const now = Date.now();
    for (const [key, val] of tokenCache) {
      if (val.expiresAt <= now) tokenCache.delete(key);
    }
  },
  5 * 60 * 1000,
).unref();

function cacheToken(token: string, userId: string): void {
  if (tokenCache.size >= MAX_CACHE_SIZE) {
    const oldest = tokenCache.keys().next().value;
    if (oldest) tokenCache.delete(oldest);
  }
  tokenCache.set(token, { userId, expiresAt: Date.now() + TOKEN_CACHE_TTL });
}

export function invalidateTokenCache(token: string): void {
  tokenCache.delete(token);
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// fail open: a mongo hiccup should not lock everyone out of the dashboard. skip
// entirely when the connection is down so we don't block on query buffering.
async function isTerminated(targetType: 'guild' | 'user', targetId: string): Promise<boolean> {
  if (mongoose.connection.readyState !== 1) return false;
  try {
    return Boolean(await ServiceBlock.isBlocked(targetType, targetId));
  } catch (err) {
    console.error('[serviceBlock] dashboard check failed:', err);
    return false;
  }
}

export interface AuthRequest extends Request {
  userId?: string;
  isOwner?: boolean;
  fluxerToken?: string | null;
}

export async function validateFluxerToken(token: string): Promise<string | null> {
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.userId;
  }

  try {
    const res = await fetch(fluxerApiUrl('/users/@me'), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) return null;

    const user = (await res.json()) as { id: string };
    if (!user?.id) return null;

    cacheToken(token, user.id);

    return user.id;
  } catch {
    return null;
  }
}

export function createAuthMiddleware(_client: Client) {
  async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    let token: string | null = null;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    if (!token && req.cookies?.claudecitymod_token) {
      token = req.cookies.claudecitymod_token;
    }

    if (!token) {
      res.status(401).json({ error: authT('missingOrInvalidAuthorization') });
      return;
    }

    if (config.api.adminToken && safeCompare(token, config.api.adminToken)) {
      req.userId = config.ownerId || 'admin';
      req.isOwner = true;
      req.fluxerToken = null;
      return next();
    }

    const userId = await validateFluxerToken(token);
    if (!userId) {
      res.status(401).json({ error: authT('invalidOrExpiredToken') });
      return;
    }

    req.userId = userId;
    req.isOwner = config.ownerId ? userId === config.ownerId : false;
    req.fluxerToken = token;

    // private deployments only let allowlisted users or managers of the single
    // allowed guild into the dashboard.
    if (!req.isOwner && !(await canAccessDashboard(userId, token))) {
      res.status(403).json({ error: authT('dashboardAccessDenied') });
      return;
    }

    // service termination (ToS section 7): terminated users can't use the dashboard
    if (!req.isOwner && (await isTerminated('user', userId))) {
      res.status(403).json({ error: terminationNotice('user') });
      return;
    }

    next();
  }

  function requireOwner(req: AuthRequest, res: Response, next: NextFunction): void {
    if (!req.isOwner) {
      res.status(403).json({ error: authT('ownerOnly') });
      return;
    }
    next();
  }

  function requireGuildAccess(paramName: 'id' | 'guildId' = 'id') {
    return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
      const guildId = req.params[paramName];
      if (!guildId) {
        res.status(400).json({ error: authT('missingGuildId') });
        return;
      }

      if (!isGuildAllowed(String(guildId))) {
        res.status(403).json({ error: authT('privateGuildOnly') });
        return;
      }

      // service termination (ToS section 7): terminated guilds are off limits in
      // the dashboard. owner still gets through to manage them.
      if (!req.isOwner && (await isTerminated('guild', String(guildId)))) {
        res.status(403).json({ error: terminationNotice('guild') });
        return;
      }

      const token = req.fluxerToken;
      if (!token) {
        res.status(403).json({ error: authT('guildAccessRequiresOauth') });
        return;
      }

      try {
        const userGuildsRes = await fetch(fluxerApiUrl('/users/@me/guilds'), {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!userGuildsRes.ok) {
          res.status(502).json({ error: authT('verifyGuildAccessFailed') });
          return;
        }

        const userGuilds = (await userGuildsRes.json()) as Array<{
          id: string;
          owner_id?: string;
          permissions?: string | null;
        }>;
        const guild = userGuilds.find((g) => g.id === guildId);

        if (!guild) {
          res.status(403).json({ error: authT('notGuildMember') });
          return;
        }

        const isOwner = guild.owner_id && guild.owner_id === req.userId;
        const perms = guild.permissions ? BigInt(guild.permissions) : 0n;
        const hasAdmin = (perms & 0x8n) === 0x8n;
        const hasManageGuild = (perms & 0x20n) === 0x20n;

        if (!isOwner && !hasAdmin && !hasManageGuild) {
          res.status(403).json({ error: authT('manageGuildPermissionRequired') });
          return;
        }

        next();
      } catch {
        res.status(502).json({ error: authT('verifyGuildAccessFailed') });
      }
    };
  }

  return { authenticate, requireOwner, requireGuildAccess };
}
