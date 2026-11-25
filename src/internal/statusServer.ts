import { createServer, type Server as HttpServer } from 'http';
import type { Client } from '@fluxerjs/core';
import config from '@/config';
import { getGatewayManager, getGatewayPing } from '@/utils/gatewayPing';
import type { BotStatusSnapshot } from '@/api/botStatus';
import settingsCache from '@/utils/settingsCache';
import * as memberCounter from '@/utils/memberCounter';
import { sendUserDm } from '@/utils/sendUserDm';

let httpServer: HttpServer | null = null;

function isAuthorized(req: { headers: { authorization?: string } }): boolean {
  const token = config.api.adminToken;
  if (!token) return false;
  const header = req.headers.authorization || '';
  return header === `Bearer ${token}`;
}

function readJsonBody(req: import('http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

export function buildBotStatusSnapshot(client: Client): BotStatusSnapshot {
  const ws = getGatewayManager(client);
  const wsPing = getGatewayPing(client);
  const shard = ws?.shards?.values?.()?.next()?.value;
  const hasReadySession = Boolean(client.readyAt);
  const hasBotUser = Boolean(client.user);
  const gatewaySession = Boolean(shard?.sessionId);
  const online = (hasBotUser && hasReadySession) || (hasBotUser && gatewaySession);

  return {
    online,
    gateway: online ? 'connected' : 'disconnected',
    wsPing,
    readyAt: client.readyAt?.toISOString() || null,
    uptime: Math.floor(process.uptime()),
    guilds: client.guilds?.size ?? 0,
    pid: process.pid,
    username: client.user?.username ?? null,
    userId: client.user?.id ?? null,
    avatar: client.user?.avatar ?? null,
    updatedAt: Date.now(),
  };
}

export async function startBotStatusServer(client: Client): Promise<void> {
  if (httpServer) return;

  httpServer = createServer(async (req, res) => {
    if (!isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const url = req.url?.split('?')[0];
    if (req.method === 'GET' && url === '/internal/health') {
      const snapshot = buildBotStatusSnapshot(client);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, online: snapshot.online }));
      return;
    }

    if (req.method === 'GET' && url === '/internal/status') {
      const payload = buildBotStatusSnapshot(client);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.method === 'GET' && url === '/internal/guild-ids') {
      const ids = [...(client.guilds?.keys() || [])];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ guildIds: ids, count: ids.length }));
      return;
    }

    if (req.method === 'GET' && url === '/internal/guilds') {
      const guilds = [...(client.guilds?.values() || [])].map((guild) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon ?? null,
        memberCount: memberCounter.get(guild.id) ?? 0,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ guilds, count: guilds.length }));
      return;
    }

    if (req.method === 'POST' && url === '/internal/invalidate-settings') {
      void (async () => {
        try {
          const body = (await readJsonBody(req)) as { guildId?: string };
          const guildId = typeof body.guildId === 'string' ? body.guildId : '';
          if (!/^\d{17,20}$/.test(guildId)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid guildId' }));
            return;
          }

          await settingsCache.update(guildId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to refresh settings cache' }));
        }
      })();
      return;
    }

    if (req.method === 'POST' && url === '/internal/bug-report-reply') {
      void (async () => {
        try {
          const body = (await readJsonBody(req)) as {
            userId?: unknown;
            reportId?: unknown;
            message?: unknown;
          };
          const userId = typeof body.userId === 'string' ? body.userId : '';
          const reportId = typeof body.reportId === 'string' ? body.reportId : '';
          const message = typeof body.message === 'string' ? body.message.trim() : '';
          if (!/^\d{17,20}$/.test(userId) || !/^[a-f\d]{24}$/i.test(reportId) || !message || message.length > 4000) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid bug report reply' }));
            return;
          }

          const delivered = await sendUserDm(
            client,
            userId,
            `Reply from ${config.branding.publicName} support for bug report ${reportId}:\n\n${message}`,
          );
          if (!delivered) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Fluxer did not accept the direct message' }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to send bug report reply' }));
        }
      })();
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  const port = config.bot.internalPort;
  const bind = config.bot.internalBind;
  await new Promise<void>((resolve) => {
    httpServer!.listen(port, bind, () => resolve());
  });
}

export function stopBotStatusServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!httpServer) return resolve();
    httpServer.close((err) => {
      if (err) return reject(err);
      httpServer = null;
      resolve();
    });
  });
}
