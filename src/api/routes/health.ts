import { Router } from 'express';
import os from 'os';
import pidusage from 'pidusage';
import logBuffer from '@/services/LogBuffer';
import { getGatewayPing } from '@/utils/gatewayPing';
import type { BotRuntime } from '../botRuntime';
import { t } from '@/i18n';

function healthT(key: string): string {
  return t('en', `auditCatalog.api.routes.health.${key}`);
}

export function createHealthRouter(runtime: BotRuntime): Router {
  const router = Router();
  const client = runtime.client;

  router.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      readyAt: client.readyAt?.toISOString() || null,
      online: runtime.isBotOnline(),
      botProcess: runtime.getBotSnapshot() ? 'reachable' : 'unreachable',
    });
  });

  router.get('/latency', (_req, res) => {
    res.json({
      wsPing: getGatewayPing(client),
      timestamp: Date.now(),
    });
  });

  router.get('/process', async (_req, res) => {
    try {
      const usage = await pidusage(process.pid);
      const mem = process.memoryUsage();

      res.json({
        cpu: +usage.cpu.toFixed(1),
        memoryMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
        memoryTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(1),
        rssMB: +(mem.rss / 1024 / 1024).toFixed(1),
        uptime: process.uptime(),
        pid: process.pid,
        nodeVersion: process.version,
      });
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/host', (_req, res) => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    res.json({
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpuModel: cpus[0]?.model || healthT('unknown'),
      cpuCores: cpus.length,
      totalMemoryMB: +(totalMem / 1024 / 1024).toFixed(0),
      freeMemoryMB: +(freeMem / 1024 / 1024).toFixed(0),
      usedMemoryMB: +((totalMem - freeMem) / 1024 / 1024).toFixed(0),
      loadAvg: os.loadavg(),
      uptimeSeconds: os.uptime(),
    });
  });

  router.get('/metrics', async (_req, res) => {
    try {
      const usage = await pidusage(process.pid);
      const mem = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();

      res.json({
        timestamp: Date.now(),
        uptime: process.uptime(),
        online: runtime.isBotOnline(),
        wsPing: getGatewayPing(client),
        cpu: +usage.cpu.toFixed(1),
        memoryMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
        memoryTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(1),
        rssMB: +(mem.rss / 1024 / 1024).toFixed(1),
        hostUsedMemoryMB: +((totalMem - freeMem) / 1024 / 1024).toFixed(0),
        hostTotalMemoryMB: +(totalMem / 1024 / 1024).toFixed(0),
        loadAvg: os.loadavg(),
      });
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/logs', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const level = req.query.level as string | undefined;
    const since = parseInt(req.query.since as string) || 0;

    let entries = since > 0 ? logBuffer.getSince(since) : logBuffer.getRecent(limit);

    if (level) {
      entries = entries.filter((e) => e.level === level);
    }

    if (!since) {
      entries = entries.slice(-limit);
    }

    res.json({
      entries,
      total: logBuffer.size,
    });
  });

  return router;
}
