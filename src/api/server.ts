import express from 'express';
import { createServer, type Server as HttpServer } from 'http';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import config from '@/config';
import type { BotRuntime } from './botRuntime';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter, authLimiter, writeLimiter } from './middleware/rateLimit';
import { createRequireBotOnline } from './middleware/requireBotOnline';
import { createAuthMiddleware } from './middleware/auth';
import { createBotRouter } from './routes/bot';
import { createGuildsRouter } from './routes/guilds';
import { createStatsRouter } from './routes/stats';
import { createHealthRouter } from './routes/health';
import { createModerationRouter } from './routes/moderation';
import { createAnalyticsRouter } from './routes/analytics';
import { createAuthRouter } from './routes/auth';
import { createDataRouter } from './routes/data';
import { createPublicRouter } from './routes/public';
import { createReportsRouter } from './routes/reports';
import { setupHealthWebSocket, teardownHealthWebSocket } from './ws/healthWs';
import { setupSettingsWebSocket, teardownSettingsWebSocket } from './ws/settingsWs';
import { t } from '@/i18n';
import { fluxerApiOrigin, fluxerMediaOrigin } from '@/utils/fluxerUrls';
import { uploadsRoot } from '@/utils/uploads';

let httpServer: HttpServer | null = null;

function serverT(key: string): string {
  return t('en', `auditCatalog.api.server.${key}`);
}

export async function startApiServer(runtime: BotRuntime): Promise<void> {
  const client = runtime.client;
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'blob:'],
          scriptSrcElem: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          styleSrcElem: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'https://fluxerusercontent.com', fluxerMediaOrigin(), 'data:'],
          connectSrc: ["'self'", 'wss:', fluxerApiOrigin(), 'https://*.posthog.com'],
          frameSrc: ["'self'"],
          workerSrc: ["'self'", 'blob:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(compression());
  app.use(
    cors({
      origin: config.api.dashboardUrl || false,
      credentials: true,
    }),
  );
  app.use('/api/guilds', express.json({ limit: '5mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/', apiLimiter);
  app.use('/api/auth', authLimiter);

  const { authenticate, requireOwner, requireGuildAccess } = createAuthMiddleware(client);
  const requireBotOnline = createRequireBotOnline(runtime);

  const authRouter = createAuthRouter();

  app.use('/api/public', createPublicRouter(runtime));

  app.use('/api/auth', authRouter);
  app.use('/api/bot', authenticate, createBotRouter(runtime, requireOwner));
  app.use('/api/reports', authenticate, createReportsRouter(client, requireOwner));
  app.use(
    '/api/guilds',
    authenticate,
    writeLimiter,
    createGuildsRouter(client, requireGuildAccess('id'), requireBotOnline),
  );
  app.use('/api/stats', authenticate, requireOwner, createStatsRouter(client));
  app.use('/api/health', authenticate, requireOwner, createHealthRouter(runtime));
  app.use('/api/moderation', authenticate, createModerationRouter(requireGuildAccess('guildId')));
  app.use('/api/guilds', authenticate, createAnalyticsRouter(runtime, requireGuildAccess('id')));
  app.use('/api/data', authenticate, createDataRouter());

  const dashboardPath = path.join(__dirname, '..', '..', 'dashboard', 'dist');
  app.use('/uploads', express.static(uploadsRoot(), { maxAge: '1d' }));
  app.use(
    '/assets',
    express.static(path.join(dashboardPath, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }),
  );
  app.use(
    express.static(dashboardPath, {
      maxAge: '5m',
      index: false,
    }),
  );

  app.get('/{*path}', apiLimiter, (_req, res) => {
    const indexPath = path.join(dashboardPath, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(404).json({ error: serverT('dashboardNotBuilt') });
      }
    });
  });

  app.use(errorHandler);

  httpServer = createServer(app);

  setupHealthWebSocket(httpServer, runtime);
  setupSettingsWebSocket(httpServer);

  return new Promise((resolve) => {
    httpServer!.listen(config.api.port, () => {
      resolve();
    });
  });
}

export function stopApiServer(): Promise<void> {
  teardownHealthWebSocket();
  teardownSettingsWebSocket();
  return new Promise((resolve, reject) => {
    if (!httpServer) return resolve();
    httpServer.close((err?: Error) => {
      if (err) return reject(err);
      httpServer = null;
      resolve();
    });
  });
}
