/* eslint-disable @typescript-eslint/no-explicit-any */
import './instrument';

import * as GlitchTip from '@sentry/node';
import { Guild, Role, Client, Events, ClientUser, Routes } from '@fluxerjs/core';
import { setupGateway } from './gateway';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import mongoose from 'mongoose';
import type { APIRole } from '@fluxerjs/types';
import config from './config';
import CommandHandler from './handlers/CommandHandler';
import EventHandler from './handlers/EventHandler';
import isNetworkError from './utils/isNetworkError';
import {
  isFluxerIpBanError,
  isFluxerIpBanMessage,
  isFluxerIpBanned,
  markFluxerIpBan,
  noteFluxerApiRecovered,
  shouldLogFluxerIpBan,
  shouldReportFluxerIpBanToGlitchtip,
} from './utils/fluxerApiErrors';
import log from './utils/consoleLogger';
import type { BotClient, BotPresence, BotShardInfo } from './types';
import GuildSettings from './models/GuildSettings';
import { getWorkerStats } from './utils/workerStats';
import { isArray } from './utils/isArray';
import { installMessageLogCacheHooks } from './utils/installMessageLogCacheHooks';
import { messageFromError } from './utils/messageFromError';
import { fluxerClientInstanceOptions, hydrateFluxerInstanceFromDiscovery } from './utils/fluxerUrls';
import { getShardingOptions } from './utils/sharding';
import { startApplicationOnce } from './services/ApplicationBootstrap';
import { getEventLoopMetrics } from './services/RuntimeMetrics';
import { GatewayStartupGate } from './gateway/GatewayStartupGate';
import { scheduleTempBanExpiries } from './services/TempBanRecovery';
import activityService from './services/ActivityService';

const passiveMode = config.process.passiveMode;

if (!passiveMode) {
  installMessageLogCacheHooks();
}

if (Guild && Role) {
  Guild.prototype.fetchRoles = async function (this: Guild) {
    const data = (await this.client.rest.get(Routes.guildRoles(this.id))) as APIRole[] | Record<string, APIRole>;
    const list = Object.values(data);
    const roles = [];
    this.roles.clear();
    for (const r of list) {
      const role = new Role(this.client, r, this.id);
      this.roles.set(role.id, role);
      roles.push(role);
    }
    return roles;
  };
}

// temporarily receiving all gateway events to monitor which we need; restore list when done
const IGNORED_GATEWAY_EVENTS: string[] = [];
let isShuttingDown = false;
const confirmedGatewaySessions = new Set<number>();
const gatewayResumeStartSeq = new Map<number, number>();
/** Suppress guild-create replay work until this timestamp (ms). */
let gatewayReplayUntil = 0;
const GATEWAY_REPLAY_SUPPRESS_MS = 3 * 60 * 1000;

interface SavedSession {
  sessionId: string;
  seq: number;
  savedAt: number;
  shardId: number;
  shardCount: number;
}
const SESSION_PATH = config.bot.gatewaySessionPath;
const SESSION_MAX_AGE_MS = 2 * 60 * 1000;

function sessionPathForShard(shardId: number, shardCount: number): string {
  return shardCount > 1 ? `${SESSION_PATH}.shard-${shardId}` : SESSION_PATH;
}

function loadSavedSession(shardId: number, shardCount: number): SavedSession | null {
  const sessionPath = sessionPathForShard(shardId, shardCount);
  try {
    const data = JSON.parse(readFileSync(sessionPath, 'utf8')) as SavedSession;
    if (Date.now() - data.savedAt > SESSION_MAX_AGE_MS) {
      unlinkSync(sessionPath);
      log.info('Gateway', `Saved session expired for shard ${shardId} — fresh IDENTIFY`);
      return null;
    }
    if (data.shardCount !== shardCount || data.shardId !== shardId) {
      unlinkSync(sessionPath);
      log.info('Gateway', `Saved session topology changed for shard ${shardId} — fresh IDENTIFY`);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function deleteSavedSession(shardId = 0, shardCount = 1): void {
  try {
    unlinkSync(sessionPathForShard(shardId, shardCount));
  } catch {}
}

function saveSession(shardId: number, shardCount: number, shard: any): void {
  const sessionPath = sessionPathForShard(shardId, shardCount);
  if (!confirmedGatewaySessions.has(shardId)) {
    log.info('Gateway', `Skipping session save for shard ${shardId} — gateway never confirmed`);
    deleteSavedSession(shardId, shardCount);
    return;
  }
  if (!shard?.sessionId || shard.seq === null) return;
  try {
    const data: SavedSession = {
      sessionId: shard.sessionId,
      seq: shard.seq,
      savedAt: Date.now(),
      shardId,
      shardCount,
    };
    writeFileSync(sessionPath, JSON.stringify(data));
    log.step(`Session saved for shard ${shardId} resume (seq=${shard.seq})`, null);
  } catch (err: any) {
    log.warn('Gateway', `Failed to save session for shard ${shardId}: ${err.message}`);
  }
}

function getCurrentShardCount(): number {
  const gateway = (client as any)._ws;
  const count =
    typeof gateway?.getShardCount === 'function'
      ? gateway.getShardCount()
      : gateway?.shards?.size || Number(process.env.TOTAL_SHARDS);
  return Number.isInteger(count) && count > 0 ? count : 1;
}

function getGatewayShard(shardId: number): any {
  const gateway = (client as any)._ws;
  return gateway?.shards?.get(shardId);
}

function saveGatewaySessions(): void {
  const gateway = (client as any)._ws;
  const shards = gateway?.shards;
  const shardCount = getCurrentShardCount();

  if (shards?.size) {
    for (const [shardId, shard] of shards.entries()) {
      saveSession(shardId, shardCount, shard);
    }
    return;
  }

  saveSession(0, shardCount, shards?.values?.()?.next()?.value);
}

setupGateway({
  ignoredEvents: IGNORED_GATEWAY_EVENTS,
  omitIntentsOnIdentify: true,
  omitPresenceOnIdentify: true,
  formatToken: (token: string) => (token.startsWith('Bot ') ? token : `Bot ${token}`),
  restoreSession: loadSavedSession,
  clearRestoredSession: deleteSavedSession,
  resumeConfirmTimeoutMs: 10_000,
  fastHeartbeatMs: 500,
  fastHeartbeatDurationMs: 30_000,
  onFastHeartbeatTick: (shardId: number, count: number, seq: number | null) => {
    log.debug('Gateway', `Shard ${shardId} fast HB × ${count}, seq=${seq ?? 'null'}`);
  },
  onFastHeartbeatDone: (shardId: number, count: number, seq: number | null) => {
    log.info('Gateway', `Shard ${shardId} fast heartbeat phase done (${count} beats, seq=${seq ?? 'null'})`);
    if (confirmedGatewaySessions.has(shardId) || isShuttingDown) return;
    const shard = getGatewayShard(shardId);
    const shardCount = getCurrentShardCount();
    const resumeStartSeq = gatewayResumeStartSeq.get(shardId);
    if (typeof shard?.seq === 'number' && typeof resumeStartSeq === 'number' && shard.seq > resumeStartSeq) {
      gatewayResumeStartSeq.delete(shardId);
      confirmedGatewaySessions.add(shardId);
      log.info('Gateway', `Shard ${shardId} resume confirmed via seq advance (${resumeStartSeq} → ${shard.seq})`);
      return;
    }
    log.warn('Gateway', `Shard ${shardId} resume never confirmed after fast HB — clearing session, reconnecting`);
    deleteSavedSession(shardId, shardCount);
    gatewayResumeRecoveryInFlight = false;
    if (!shard) return;
    shard.sessionId = null;
    shard.seq = null;
    const ws = shard.ws;
    shard.ws = null;
    shard.stopHeartbeat?.();
    if (ws?.readyState === 1) {
      try {
        ws.close(1000);
      } catch {}
    }
    if (shard.phase !== 3) {
      shard.connect?.();
    }
  },
  isShuttingDown: () => isShuttingDown,
  onSessionRestored: (shardId: number, _sessionId: string, seq: number) => {
    log.info('Gateway', `Restoring shard ${shardId} session from disk → seq=${seq}`);
  },
  onIdentify: (shardId: number, ignoredEvents: string[]) => {
    confirmedGatewaySessions.delete(shardId);
    gatewayResumeStartSeq.delete(shardId);
    log.info('Gateway', `Shard ${shardId} identify → ignored_events=${ignoredEvents.join(',') || '(none)'}`);
    const shard = getGatewayShard(shardId);
    if (shard) {
      shard.__ccmFastHeartbeatUntil = Date.now() + GATEWAY_REPLAY_SUPPRESS_MS;
    }
  },
  onResume: (shardId: number, sessionId: string, seq: number) => {
    confirmedGatewaySessions.delete(shardId);
    gatewayResumeRecoveryInFlight = false;
    gatewayResumeStartSeq.set(shardId, seq);
    gatewayReplayUntil = Date.now() + GATEWAY_REPLAY_SUPPRESS_MS;
    const shard = getGatewayShard(shardId);
    if (shard) {
      shard.__ccmFastHeartbeatUntil = Date.now() + GATEWAY_REPLAY_SUPPRESS_MS;
    }
    log.info('Gateway', `Shard ${shardId} resume → session=${sessionId}, seq=${seq}`);
  },
  onResumeDispatch: (shardId: number) => handleGatewayResumed(shardId, 'dispatch replay'),
  onResumeTimeout: (shardId: number) => {
    log.warn('Gateway', 'Resume not confirmed in 10s — clearing session, reconnecting');
    deleteSavedSession(shardId, getCurrentShardCount());
  },
});

try {
  config.validate();
} catch (error: any) {
  log.fatal('Config', error.message);
  process.exit(1);
}

function logTokenFingerprint(): void {
  try {
    const token = config.token || '';
    const trimmed = token.trim();
    if (trimmed !== token) {
      log.warn('Config', 'TOKEN has leading/trailing whitespace; trimming is recommended.');
    }
    const fingerprint = createHash('sha256').update(trimmed).digest('hex').slice(0, 10);
    log.info('Config', `TOKEN fingerprint: ${fingerprint} (len=${trimmed.length})`);
  } catch (error: any) {
    log.warn('Config', `Failed to compute TOKEN fingerprint: ${error?.message || error}`);
  }
}

if (config.glitchtip.dsn && !passiveMode) {
  log.ok('GlitchTip', `Initialized (env: ${config.glitchtip.environment})`);

  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    originalConsoleError.apply(console, args);
    const message = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (message.includes('MaxListenersExceededWarning')) return;
    if (isFluxerIpBanMessage(message)) return;

    const err = args.find((a) => a instanceof Error);
    if (err) {
      GlitchTip.captureException(err);
    } else {
      GlitchTip.captureMessage(message, 'error');
    }
  };

  process.on('warning', (warning) => {
    if (warning.name === 'MaxListenersExceededWarning') return;
    GlitchTip.captureMessage(`${warning.name}: ${warning.message}`, 'warning');
  });
} else {
  log.info('GlitchTip', 'No DSN configured - error tracking disabled');
}

logTokenFingerprint();

const BOT_PRESENCE: BotPresence = {
  status: 'online' as const,
  custom_status: { text: 'Starting up...' },
  afk: false,
};

const shardingOptions = getShardingOptions();

const client: BotClient = new Client({
  presence: BOT_PRESENCE,
  waitForGuilds: true,
  defaultReplyPing: false,
  // We need every guild cached for settings lookups, presence count, and resume
  // rebuild. 0 = unbounded.
  cache: { guilds: 0 },
  ...fluxerClientInstanceOptions(),
  ...shardingOptions,
});

// init handlers
const commandHandler = new CommandHandler(client);
const eventHandler = new EventHandler(client);

client.commandHandler = commandHandler;
client.eventHandler = eventHandler;
// value gets set and should not be reset
(client as { -readonly [K in 'presenceRef']: (typeof client)['presenceRef'] }).presenceRef = BOT_PRESENCE;

/**
 * if an error is a transient network/WebSocket error, bot will be okie
 */
function isTransientError(error: any): boolean {
  if (isNetworkError(error)) return true;

  const errorMessage = error?.message?.toLowerCase() || '';
  const errorName = error?.name?.toLowerCase() || '';

  // ws errors
  if (
    errorMessage.includes('websocket') ||
    errorMessage.includes('socket hang up') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('etimedout') ||
    errorMessage.includes('enotfound') ||
    errorMessage.includes('network') ||
    errorName.includes('websocketerror')
  ) {
    return true;
  }

  // da error codes yur
  const transientCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE'];
  if (error?.code && transientCodes.includes(error.code)) {
    return true;
  }

  return false;
}

let mongoReconnecting = false;

function setupMongoListeners(): void {
  mongoose.connection.on('connected', () => {
    log.ok('MongoDB', 'Connected');
    mongoReconnecting = false;
  });

  mongoose.connection.on('disconnected', () => {
    log.warn('MongoDB', 'Disconnected');
    if (passiveMode || mongoReconnecting || isShuttingDown) return;
    mongoReconnecting = true;
    attemptMongoReconnect();
  });

  mongoose.connection.on('error', (err) => {
    log.error('MongoDB', err.message);
  });
}

async function attemptMongoReconnect(): Promise<void> {
  // semi-exponential back-off
  const DELAYS = [2000, 5000, 10000, 30000, 60000] as const;
  let attempt = 0;

  while (!isShuttingDown) {
    const delay = DELAYS[Math.min(attempt, DELAYS.length - 1)]!; /* index is checked against known constant length */
    log.warn('MongoDB', `Reconnecting in ${delay / 1000}s (attempt ${attempt + 1})...`);
    await new Promise((r) => setTimeout(r, delay));

    if (isShuttingDown) break;
    if (mongoose.connection.readyState === 1) {
      log.ok('MongoDB', 'Already reconnected.');
      mongoReconnecting = false;
      return;
    }

    try {
      await mongoose.connect(config.mongoUri);
      log.ok('MongoDB', 'Reconnected successfully.');
      mongoReconnecting = false;
      return;
    } catch (err: any) {
      log.error('MongoDB', `Reconnect attempt ${attempt + 1} failed: ${err.message}`);
      attempt++;
    }
  }
}

async function connectDatabase(): Promise<void> {
  if (process.env.SKIP_MONGO === '1') {
    log.warn('MongoDB', 'Skipped (SKIP_MONGO=1)');
    return;
  }

  const MAX_INITIAL_RETRIES = 5;
  const mongoOptions = {
    maxPoolSize: 10,
    minPoolSize: 2,
    socketTimeoutMS: 30000,
    serverSelectionTimeoutMS: 10000,
    heartbeatFrequencyMS: 15000,
    bufferCommands: false,
  };

  for (let attempt = 1; attempt <= MAX_INITIAL_RETRIES; attempt++) {
    try {
      await mongoose.connect(config.mongoUri, mongoOptions);
      setupMongoListeners();
      return;
    } catch (error: any) {
      log.error('MongoDB', `Attempt ${attempt}/${MAX_INITIAL_RETRIES} failed: ${error.message}`);
      if (attempt === MAX_INITIAL_RETRIES) {
        log.fatal('MongoDB', 'Connection failed after all retries. Exiting.');
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

/**
 * init the bob
 */
async function init(): Promise<void> {
  const initStart = Date.now();

  log.banner([
    `${log.c.bold}${log.c.bCyan}${config.branding.fullName}${log.c.reset}  ${log.c.gray}v${config.appVersion}${log.c.reset}`,
  ]);

  log.divider('Startup');
  if (passiveMode) {
    log.warn('Startup', 'Passive mode — gateway only, no commands/events/side effects');
  }

  try {
    const dbStart = Date.now();
    const dbPromise = connectDatabase();

    if (!passiveMode) {
      const loadStart = Date.now();
      await commandHandler.loadCommands();
      const cmdTime = Date.now() - loadStart;
      log.step(`Commands loaded (${commandHandler.commands.size})`, cmdTime);

      const evtStart = Date.now();
      await eventHandler.loadEvents();
      log.step(`Event handlers loaded`, Date.now() - evtStart);
    } else {
      log.step('Commands/events skipped (passive mode)', null);
    }

    // Wait for DB if it hasn't finished yet
    await dbPromise;
    log.step('MongoDB connected', Date.now() - dbStart);

    if (config.api.enabled && config.process.mode !== 'bot') {
      try {
        const { startApiServer } = await import('./api/server');
        const { createInProcessBotRuntime } = await import('./api/inProcessBotRuntime');
        const runtime = createInProcessBotRuntime(client, commandHandler);
        await startApiServer(runtime);
        log.step(`API server started on :${config.api.port}`, null);
      } catch (err: any) {
        log.error('API', `Failed to start API server: ${err.message}`);
      }
    }

    if (!passiveMode) {
      try {
        const guildCount = await GuildSettings.countDocuments();
        log.step(`Guild settings in DB: ${guildCount}`, null);
      } catch {}
    }

    await hydrateFluxerInstanceFromDiscovery();

    const loginStart = Date.now();
    await client.login(config.token);
    log.step('Gateway login', Date.now() - loginStart);

    if (config.process.mode !== 'web' && !passiveMode) {
      await ensureBotStatusServer();
    }

    console.log('');
    log.ok('Startup', `Init complete in ${Date.now() - initStart}ms`);
    console.log('');
  } catch (error: any) {
    log.fatal('Startup', `Initialization error: ${error.message || error}`);
    process.exit(1);
  }
}

const wsErrorTimestamps: number[] = [];
const WS_WATCHDOG_WINDOW_MS = 10 * 60 * 1000;
const WS_WATCHDOG_THRESHOLD = 100;
const MAX_OUTAGE_DURATION = 60 * 60 * 1000;
let glitchtipReportedAtCount = 0;
let outageStartedAt: number | null = null;
let lastSuccessfulConnection = Date.now();
let sustainedOutageReported = false;
let healthOutageReported = false;

const GATEWAY_DEAD_GRACE_MS = 120_000;
const MIN_PROCESS_RESTART_INTERVAL_MS = 5 * 60 * 1000;
let gatewayDeadSince: number | null = null;
let lastGatewayWatchdogLogAt = 0;
let lastProcessRestartRequestAt = 0;

function requestProcessRestart(reason: string, detail?: string): void {
  if (isFluxerIpBanned()) {
    log.warn('Restart', `Skipped (Fluxer IP ban active): reason=${reason}${detail ? ` ${detail}` : ''}`);
    return;
  }
  const now = Date.now();
  if (now - lastProcessRestartRequestAt < MIN_PROCESS_RESTART_INTERVAL_MS) {
    log.warn('Restart', `Skipped (rate limit): reason=${reason}${detail ? ` ${detail}` : ''}`);
    return;
  }
  lastProcessRestartRequestAt = now;
  log.error('Restart', `reason=${reason}${detail ? ` ${detail}` : ''}`);
  GlitchTip.captureMessage(`Process restart: ${reason}`, {
    level: 'warning',
    tags: { source: 'restart', reason },
    extra: detail ? { detail } : undefined,
  });
  GlitchTip.close(2000).finally(() => process.exit(1));
}

client.on(Events.ShardReady, (shardId: number) => {
  confirmedGatewaySessions.add(shardId);
  gatewayResumeStartSeq.delete(shardId);
  const shardManager = (client as any)._ws;
  const shardCount =
    typeof shardManager?.getShardCount === 'function'
      ? shardManager.getShardCount()
      : shardManager?.shards?.size || shardingOptions.shardIds?.length || 1;
  log.info('Gateway', `Shard ${shardId} ready (${shardCount} total)`);
});

client.on(Events.ShardingRequired, ({ shardId, numShards }) => {
  log.error(
    'Gateway',
    `Gateway requires at least ${numShards} shards (current shard ${shardId}) — restarting to recalculate`,
  );
  requestProcessRestart('gateway_sharding_required', `shard=${shardId} required=${numShards}`);
});

// presence alternates each refresh: even ticks show the server count, odd ticks
// the member count. module-level so it survives across the interval.
let presenceRotation = 0;

async function refreshPresence(logCounts = false): Promise<void> {
  try {
    const guilds = await fetchTotalGuildCount();
    if (guilds <= 0) return;

    const showMembers = presenceRotation % 2 === 1;
    presenceRotation++;

    let text: string;
    if (showMembers) {
      const stats = await fetchAllStats();
      text = `Managing ${stats.members.toLocaleString('en-US')} users`;
    } else {
      text = `Watching ${guilds.toLocaleString('en-US')} servers`;
    }

    BOT_PRESENCE.custom_status.text = text;
    pushPresenceUpdate(text);
    if (logCounts) {
      log.info('Presence', text);
    }
  } catch (error: any) {
    log.warn('Presence', `Failed to refresh presence: ${error?.message || error}`);
  }
}

// fluxer.js v2 setPresence takes camelCase options (customStatus); the old
// snake_case custom_status shape gets silently dropped by toPresenceWire.
function pushPresenceUpdate(text: string): void {
  try {
    client.user?.setPresence({ status: 'online', afk: false, customStatus: { text } });
  } catch {}
}

client.on(Events.Error, (error: any) => {
  if (isTransientError(error)) {
    const now = Date.now();
    wsErrorTimestamps.push(now);

    while ('0' in wsErrorTimestamps && wsErrorTimestamps[0] < now - WS_WATCHDOG_WINDOW_MS) {
      wsErrorTimestamps.shift();
    }

    if (!outageStartedAt) outageStartedAt = now;

    if (wsErrorTimestamps.length >= WS_WATCHDOG_THRESHOLD && now - outageStartedAt > MAX_OUTAGE_DURATION) {
      if (!sustainedOutageReported) {
        sustainedOutageReported = true;
        log.error(
          'Watchdog',
          `${WS_WATCHDOG_THRESHOLD}+ errors over ${Math.round((now - outageStartedAt) / 60000)}min sustained outage. Keeping the process alive and letting the gateway retry.`,
        );
        GlitchTip.captureMessage(
          `Gateway outage persisted past watchdog threshold: ${wsErrorTimestamps.length} errors over ${Math.round((now - outageStartedAt) / 1000)}s`,
          {
            level: 'error',
            tags: { source: 'ws_watchdog', action: 'continue' },
            extra: {
              errorCount: wsErrorTimestamps.length,
              outageDurationSeconds: Math.round((now - outageStartedAt) / 1000),
              lastError: error.message || String(error),
            },
          },
        );
      }
    }

    if (wsErrorTimestamps.length % 5 === 1 || wsErrorTimestamps.length <= 3) {
      log.warn(
        'Network',
        `Hiccup ${wsErrorTimestamps.length}/${WS_WATCHDOG_THRESHOLD} - ${error.message || error} - SDK retrying`,
      );
    }

    const glitchtipThresholds = [10, 20, 35, WS_WATCHDOG_THRESHOLD];
    const count = wsErrorTimestamps.length;
    const outageDuration = outageStartedAt ? Math.round((now - outageStartedAt) / 1000) : 0;
    for (const threshold of glitchtipThresholds) {
      if (count >= threshold && glitchtipReportedAtCount < threshold) {
        glitchtipReportedAtCount = threshold;
        GlitchTip.captureMessage(`Gateway connectivity degraded: ${count} WebSocket errors in ${outageDuration}s`, {
          level: 'warning',
          tags: { source: 'ws_watchdog', threshold: String(threshold) },
          extra: {
            errorCount: count,
            outageDurationSeconds: outageDuration,
            lastError: error.message || String(error),
          },
        });
        break;
      }
    }

    if (process.env.DEBUG && error.cause) {
      log.debug('Network', 'Cause:', error.cause);
    }
  } else if (isFluxerIpBanError(error)) {
    markFluxerIpBan(error);
    if (shouldLogFluxerIpBan()) {
      log.error('Fluxer', `${error.message || error} — backing off, not restarting`);
    }
    if (shouldReportFluxerIpBanToGlitchtip()) {
      GlitchTip.captureMessage('Fluxer API IP temporarily banned — backing off', {
        level: 'warning',
        tags: { source: 'fluxer_ip_ban' },
        extra: { message: error.message || String(error) },
      });
    }
  } else {
    log.error('Client', `${error.message || error} (code: ${error.code || 'unknown'})`);
    GlitchTip.captureException(error, {
      tags: { source: 'client_error' },
    });
  }
});

client.on(Events.Debug, (message: string) => {
  if (process.env.DEBUG) {
    log.debug('Gateway', message);
  }

  if (message.includes('Heartbeat ack missed')) {
    const eventLoop = getEventLoopMetrics();
    log.warn(
      'Gateway',
      `${message} (event-loop p95=${eventLoop.p95Ms.toFixed(1)}ms, max=${eventLoop.maxMs.toFixed(1)}ms, ${eventLoop.status})`,
    );
  }

  if (message.includes('Invalid session')) {
    log.warn('Recovery', 'Invalid session — SDK will reconnect');
  }

  if (message.includes('Closed: 4013')) {
    log.warn('Recovery', 'Gateway 4013 (ack backpressure) — restarting process');
    requestProcessRestart('gateway_4013');
    return;
  }

  // erin.js doesn't reconnect on 4008; Fluxer closes with this when outbound op rate exceeds 120/60s
  if (message.includes('Closed: 4008')) {
    log.warn('Recovery', 'Gateway 4008 (rate limited) — fresh identify in 60s');
    const shard: any = (client as any)._ws?.shards?.values()?.next()?.value;
    if (shard && !shard.__ccm4008Recovery) {
      shard.__ccm4008Recovery = true;
      shard.sessionId = null;
      shard.seq = null;
      deleteSavedSession();
      setTimeout(() => {
        shard.__ccm4008Recovery = false;
        if (!isShuttingDown && shard.ws?.readyState !== 1 && shard.phase !== 3) {
          log.info('Recovery', 'Reconnecting after 4008 cooldown');
          shard.connect();
        }
      }, 60_000);
    }
    return;
  }

  if (message.includes('Closed: 4004')) {
    log.error('Recovery', 'Gateway 4004 — auth failed, cannot reconnect in-process');
    GlitchTip.captureMessage('Gateway 4004 (auth failed on reconnect)', {
      level: 'error',
      tags: { source: 'gateway_4004' },
    });
  }
});

async function ensureClientReadyState(): Promise<void> {
  if (!(client as any).readyAt) {
    (client as any).readyAt = new Date();
  }
  if (!(client as any).user) {
    try {
      const me = (await client.rest.get('/users/@me')) as any;
      if (me?.id) {
        (client as any).user = new ClientUser(client as any, me);
      }
    } catch (err: any) {
      log.warn('Gateway', `Could not load bot user: ${err?.message}`);
    }
  }
}

async function ensureBotStatusServer(): Promise<void> {
  try {
    const { startBotStatusServer } = await import('./internal/statusServer');
    await startBotStatusServer(client);
    log.ok('Internal', `Status server on ${config.bot.internalBind}:${config.bot.internalPort}`);
  } catch (err: any) {
    log.warn('Internal', `Status server failed: ${err?.message}`);
  }
}

let presenceInterval: ReturnType<typeof setInterval> | null = null;

function startPresenceUpdates(): void {
  setTimeout(() => {
    if (isShuttingDown) return;
    void refreshPresence(true);
    if (!presenceInterval) {
      presenceInterval = setInterval(
        () => {
          if (!isShuttingDown) void refreshPresence();
        },
        5 * 60 * 1000,
      );
    }
  }, 15_000);
}

interface GatewaySessionStartLimit {
  remaining?: number;
  total?: number;
  reset_after?: number;
  max_concurrency?: number | null;
}

function scheduleGatewayInfo(): void {
  setTimeout(() => {
    if (isShuttingDown) return;
    client.rest
      .get('/gateway/bot')
      .then((gatewayInfo: unknown) => {
        const limit = (gatewayInfo as { session_start_limit?: GatewaySessionStartLimit })?.session_start_limit;
        if (limit !== null && limit !== undefined) {
          const { remaining, total, reset_after, max_concurrency } = limit;
          const resetSec = typeof reset_after === 'number' ? Math.round(reset_after / 1000) : '?';
          log.info(
            'Gateway',
            `Session limit: ${remaining}/${total} remaining, resets in ${resetSec}s` +
              (max_concurrency !== null && max_concurrency !== undefined
                ? `, max_concurrency: ${max_concurrency}`
                : ''),
          );
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, 30_000);
}

const gatewayStartup = new GatewayStartupGate({
  passive: passiveMode,
  startApplication: () => {
    startApplicationOnce(client);
  },
  startPresenceUpdates,
  scheduleTempBanExpiries: () => {
    void scheduleTempBanExpiries(client);
  },
  scheduleGatewayInfo,
});

function markGatewayOperational(signal: 'ready' | 'resume'): void {
  try {
    if (signal === 'ready') {
      gatewayStartup.onReady();
    } else {
      gatewayStartup.onResume();
    }
  } catch (error: unknown) {
    log.error('Startup', `Gateway startup failed: ${messageFromError(error)}`);
  }
}

client.on(Events.Ready, () => {
  void ensureClientReadyState();

  gatewayDeadSince = null;
  lastSuccessfulConnection = Date.now();
  noteFluxerApiRecovered();
  log.ok(
    'Gateway',
    `online guilds=${client.guilds?.size ?? 0} gateway=connected processUptime=${Math.floor(process.uptime())}s`,
  );
  outageStartedAt = null;
  wsErrorTimestamps.length = 0;
  glitchtipReportedAtCount = 0;
  sustainedOutageReported = false;
  healthOutageReported = false;
  markGatewayOperational('ready');
});

let gatewayResumeRecoveryInFlight = false;

function handleGatewayResumed(shardId: number, via: 'resumed' | 'dispatch replay'): void {
  confirmedGatewaySessions.add(shardId);
  gatewayResumeStartSeq.delete(shardId);
  if (gatewayResumeRecoveryInFlight) return;
  gatewayResumeRecoveryInFlight = true;
  gatewayReplayUntil = Date.now() + GATEWAY_REPLAY_SUPPRESS_MS;

  void ensureClientReadyState();

  gatewayDeadSince = null;
  const downtime = outageStartedAt ? Math.round((Date.now() - outageStartedAt) / 1000) : 0;
  if (via === 'dispatch replay') {
    log.ok('Reconnect', 'Connection resumed (dispatch replay)');
  } else if (downtime > 5) {
    log.ok('Reconnect', `Connection resumed after ~${downtime}s downtime`);
  } else {
    log.ok('Reconnect', 'Connection resumed');
  }
  lastSuccessfulConnection = Date.now();
  outageStartedAt = null;
  wsErrorTimestamps.length = 0;
  glitchtipReportedAtCount = 0;
  sustainedOutageReported = false;
  healthOutageReported = false;
  noteFluxerApiRecovered();
  markGatewayOperational('resume');

  if (passiveMode) {
    void refreshPresence();
    gatewayResumeRecoveryInFlight = false;
    return;
  }

  (async () => {
    const yieldLoop = () => new Promise<void>((resolve) => setImmediate(resolve));
    try {
      const all: any[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        all.length = 0;
        let after: string | undefined;
        for (;;) {
          const url = '/users/@me/guilds' + (after ? `?after=${after}&limit=200` : '?limit=200');
          const res = (await client.rest.get(url)) as any;
          const page = isArray(res) ? res : (res?.guilds ?? []);
          if (!page.length) break;
          all.push(...page);
          if (page.length < 200) break;
          after = page[page.length - 1].id;
          await yieldLoop();
        }
        if (all.length > 0) break;
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
      if (all.length === 0) {
        log.warn(
          'Reconnect',
          `Guild cache rebuild skipped (REST returned 0, keeping ${client.guilds?.size ?? 0} cached)`,
        );
      } else {
        for (let i = 0; i < all.length; i++) {
          const data = all[i];
          const existing = client.guilds.get(data.id);
          if (existing) {
            if (data.name) existing.name = data.name;
            if ('icon' in data) existing.icon = data.icon ?? null;
            continue;
          }
          const guild = new Guild(client, data);
          (client.guilds as any).set(guild.id, guild);
          if (i % 50 === 49) await yieldLoop();
        }
        log.step(`Guild cache rebuilt after resume (${all.length} guilds)`, null);
      }
    } catch (err: any) {
      log.warn('Reconnect', `Guild cache rebuild failed: ${err?.message}`);
    } finally {
      gatewayResumeRecoveryInFlight = false;
      void refreshPresence(true);
    }
  })();
}

client.on(Events.ShardResumed, (shardId: number) => handleGatewayResumed(shardId, 'resumed'));

setInterval(
  () => {
    if (isShuttingDown) return;
    const now = Date.now();
    const sinceLastSuccess = now - lastSuccessfulConnection;

    if (sinceLastSuccess > 15 * 60 * 1000 && wsErrorTimestamps.length > 10) {
      log.warn(
        'Health',
        `No connection in ${Math.round(sinceLastSuccess / 60000)}min - ${wsErrorTimestamps.length} errors - SDK retrying`,
      );
      if (!healthOutageReported) {
        healthOutageReported = true;
        GlitchTip.captureMessage('Sustained gateway outage: no connection for 15+ minutes', {
          level: 'error',
          tags: { source: 'health_monitor' },
          extra: {
            minutesSinceLastSuccess: Math.round(sinceLastSuccess / 60000),
            errorCount: wsErrorTimestamps.length,
          },
        });
      }
    }
  },
  5 * 60 * 1000,
);

setInterval(
  () => {
    if (passiveMode || isShuttingDown) return;
    const botId = client.user?.id;
    let swept = 0;
    for (const guild of client.guilds.values()) {
      const size = (guild as any).members.size;
      if (size <= 1) continue; // only bot's own member or empty
      for (const [id] of (guild as any).members) {
        if (id !== botId) {
          (guild as any).members.delete(id);
          swept++;
        }
      }
    }
    if (swept > 0) {
      const memMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
      log.info('Sweep', `Cleared ${swept.toLocaleString()} cached members - heap: ${memMB} MB`);
    }
  },
  10 * 60 * 1000,
); // every 10 min

process.on('unhandledRejection', (reason: any) => {
  if (reason instanceof Error && (isTransientError(reason) || isFluxerIpBanError(reason))) {
    if (isFluxerIpBanError(reason)) markFluxerIpBan(reason);
    log.warn('Rejection', `${reason.message} - continuing`);
    return;
  }
  GlitchTip.captureException(reason);
  log.error('Rejection', reason?.message || reason);
});

process.on('uncaughtException', (error) => {
  if (isTransientError(error) || isFluxerIpBanError(error)) {
    if (isFluxerIpBanError(error)) markFluxerIpBan(error);
    log.warn('Exception', `${error.message} - continuing`);
    return;
  }
  GlitchTip.captureException(error);
  log.fatal('Exception', error.message || String(error));
  // Route through graceful shutdown so the session is saved and logs flush
  void gracefulShutdown('uncaughtException').finally(() => process.exit(1));
});

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.divider('Shutdown');
  log.info('Shutdown', `Received ${signal}`);

  try {
    saveGatewaySessions();

    if (config.api.enabled && config.process.mode !== 'bot') {
      const { stopApiServer } = await import('./api/server');
      await stopApiServer().catch((err: any) => {
        log.warn('Shutdown', `API stop: ${err?.message || err}`);
      });
    }

    if (config.process.mode !== 'web') {
      const { stopBotStatusServer } = await import('./internal/statusServer');
      await stopBotStatusServer().catch((err: any) => {
        log.warn('Shutdown', `Status server stop: ${err?.message || err}`);
      });
    }

    client.destroy();
    log.step('Client destroyed', null);

    await activityService.stop();
    log.step('Activity analytics flushed', null);

    await mongoose.disconnect();
    log.step('MongoDB disconnected', null);

    // Flush pending GlitchTip events before exit
    await GlitchTip.close(2000);

    log.ok('Shutdown', 'Clean exit');
    process.exit(0);
  } catch (error: any) {
    log.error('Shutdown', error.message || error);
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

async function fetchTotalGuildCount(): Promise<number> {
  return client.guilds?.size || 0;
}

function shardIdForGuild(guildId: string, shardCount: number): number | null {
  try {
    return Number((BigInt(guildId) >> 22n) % BigInt(shardCount));
  } catch {
    return null;
  }
}

async function fetchAllShardInfo(): Promise<BotShardInfo[]> {
  const gateway = (client as any)._ws;
  const shards = (typeof gateway?.getShards === 'function' ? gateway.getShards() : gateway?.shards) as
    ReadonlyMap<number, any> | undefined;
  const shardCount =
    (typeof gateway?.getShardCount === 'function' ? gateway.getShardCount() : undefined) ||
    shards?.size ||
    Number(process.env.TOTAL_SHARDS) ||
    1;

  if (shards?.size) {
    const guildCounts = new Map<number, number>();
    for (const guild of client.guilds.values()) {
      const shardId = shardIdForGuild(guild.id, shardCount);
      if (shardId !== null) guildCounts.set(shardId, (guildCounts.get(shardId) ?? 0) + 1);
    }

    const workerId = Number(process.env.WORKER_ID) || 0;
    const memory = Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
    return [...shards.entries()].map(([shardId, shard]) => ({
      workerId,
      shardIds: [shardId],
      status: shard.status === 1 || shard.ws?.readyState === 1 ? 'online' : 'offline',
      guilds: guildCounts.get(shardId) ?? 0,
      memory,
      uptime: Math.floor(process.uptime()),
      ping: typeof shard.ping === 'number' && shard.ping >= 0 ? shard.ping : null,
    }));
  }

  return [
    {
      workerId: Number(process.env.WORKER_ID) || 0,
      shardIds: [0],
      status: 'online',
      guilds: client.guilds?.size || 0,
      memory: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
      uptime: Math.floor(process.uptime()),
      ping: (client as any)._ws?.ping ?? null,
    },
  ];
}

async function fetchAllGuildIds(): Promise<Set<string>> {
  return new Set(client.guilds?.keys() || []);
}

async function fetchAllStats(): Promise<{ guilds: number; members: number; memory: number; uptime: number }> {
  return getWorkerStats(client);
}

client.fetchTotalGuildCount = fetchTotalGuildCount;
client.fetchAllStats = fetchAllStats;
client.fetchAllShardInfo = fetchAllShardInfo;
client.fetchAllGuildIds = fetchAllGuildIds;
client.isGatewayRecovering = () => gatewayResumeRecoveryInFlight;
client.isGatewayReplayActive = () => gatewayResumeRecoveryInFlight || Date.now() < gatewayReplayUntil;

export { client, commandHandler, eventHandler };

if (config.process.mode === 'web') {
  log.fatal('Startup', 'CCM_PROCESS=web — run node build/api/standalone.js instead');
  process.exit(1);
}

init();

setInterval(() => {
  if (isShuttingDown || !gatewayStartup.isOperational) return;

  const shard: any = (client as any)._ws?.shards?.values()?.next()?.value;
  if (!shard) return;

  const connected = shard.ws?.readyState === 1;
  const reconnecting = shard.reconnectTimeout !== null;

  if (connected) {
    gatewayDeadSince = null;
    return;
  }

  if (reconnecting || shard.phase === 3 || shard.__ccm4008Recovery) {
    gatewayDeadSince = null;
    return;
  }

  const now = Date.now();
  if (!gatewayDeadSince) gatewayDeadSince = now;

  const deadForMs = now - gatewayDeadSince;
  if (isFluxerIpBanned()) {
    if (now - lastGatewayWatchdogLogAt > 5 * 60 * 1000) {
      lastGatewayWatchdogLogAt = now;
      log.warn('Watchdog', 'Gateway down during Fluxer IP ban — waiting, not restarting');
    }
    return;
  }

  if (deadForMs < GATEWAY_DEAD_GRACE_MS) {
    if (now - lastGatewayWatchdogLogAt > 30_000) {
      lastGatewayWatchdogLogAt = now;
      log.warn(
        'Watchdog',
        `Gateway disconnected ${Math.round(deadForMs / 1000)}s (grace ${GATEWAY_DEAD_GRACE_MS / 1000}s) — waiting for SDK reconnect`,
      );
    }
    return;
  }

  requestProcessRestart('gateway_watchdog', `deadForMs=${deadForMs}`);
}, 15_000);
