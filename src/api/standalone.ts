import '../instrument';

import mongoose from 'mongoose';
import config from '@/config';
import log from '@/utils/consoleLogger';
import { startApiServer } from './server';
import { createRemoteBotRuntime } from './remoteBotRuntime';
import { messageFromError } from '@/utils/messageFromError';
import { hydrateFluxerInstanceFromDiscovery } from '@/utils/fluxerUrls';
import activityService from '@/services/ActivityService';

async function connectDatabase(): Promise<void> {
  await mongoose.connect(config.mongoUri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    socketTimeoutMS: 30000,
    serverSelectionTimeoutMS: 10000,
    heartbeatFrequencyMS: 15000,
    bufferCommands: false,
  });
}

async function main(): Promise<void> {
  if (!config.api.enabled) {
    log.fatal('API', 'API_ENABLED must be true for the web process');
    process.exit(1);
  }

  try {
    config.validate();
  } catch (error) {
    log.fatal('Config', messageFromError(error));
    process.exit(1);
  }

  if (!config.api.adminToken) {
    log.fatal('Config', 'API_ADMIN_TOKEN is required for web ↔ bot communication');
    process.exit(1);
  }

  log.banner([
    `${log.c.bold}${log.c.bCyan}${config.branding.fullName} Web${log.c.reset}  ${log.c.gray}dashboard + api${log.c.reset}`,
  ]);

  await connectDatabase();
  log.ok('MongoDB', 'Connected');

  await hydrateFluxerInstanceFromDiscovery();

  const runtime = createRemoteBotRuntime();
  activeRuntime = runtime;
  await runtime.start();
  activityService.start();
  await startApiServer(runtime);
  log.ok('API', `Listening on :${config.api.port}`);
}

let activeRuntime: Awaited<ReturnType<typeof createRemoteBotRuntime>> | null = null;

async function shutdown(signal: string): Promise<void> {
  log.info('Shutdown', `Received ${signal}`);
  const { stopApiServer } = await import('./server');
  await stopApiServer().catch(() => {});
  await activeRuntime?.stop().catch(() => {});
  await activityService.stop().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((err) => {
  log.fatal('API', err?.message || String(err));
  process.exit(1);
});
