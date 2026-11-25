import * as GlitchTip from '@sentry/node';
import config from './config';
import { isFluxerIpBanMessage } from './utils/fluxerApiErrors';
import { recordGlitchTipError } from './services/RuntimeMetrics';

const dsn = process.env.GLITCHTIP_DSN || '';
const environment = process.env.GLITCHTIP_ENVIRONMENT || process.env.NODE_ENV || 'production';
const debug = process.env.GLITCHTIP_DEBUG === 'true';

function isBenignNodeWarning(message: string): boolean {
  return (
    message.includes('MaxListenersExceededWarning') || message.includes('Possible EventEmitter memory leak detected')
  );
}

function isNoise(message: string): boolean {
  return isBenignNodeWarning(message) || isFluxerIpBanMessage(message);
}

if (dsn) {
  GlitchTip.init({
    dsn,
    environment,
    release: `${config.branding.dataName}@${config.appVersion}`,
    tracesSampleRate: 0,
    sendDefaultPii: true,
    debug,
    enableLogs: true,
    integrations: [GlitchTip.consoleLoggingIntegration({ levels: ['warn', 'error'] })],
    beforeSend(event) {
      const message = event.message || event.exception?.values?.[0]?.value || event.logentry?.message || '';
      if (typeof message === 'string' && isNoise(message)) return null;
      if (event.exception || event.level === 'error' || event.level === 'fatal') {
        recordGlitchTipError();
      }
      return event;
    },
    beforeSendLog(log) {
      if (typeof log.message === 'string' && isNoise(log.message)) return null;
      return log;
    },
  });
  console.log(`[GlitchTip] SDK initialized (dsn: ${dsn.substring(0, 30)}...)`);

  GlitchTip.captureMessage(`${config.branding.publicName} process started`, {
    level: 'info',
    tags: { source: 'startup' },
  });
  GlitchTip.flush(5000)
    .then((flushed) => {
      if (flushed) {
        console.log('[GlitchTip] Startup event sent successfully');
      } else {
        console.error('[GlitchTip] WARNING: Failed to flush startup event - events may not be reaching the collector');
      }
    })
    .catch((err) => {
      console.error('[GlitchTip] Flush error:', err);
    });
} else {
  console.log('[GlitchTip] No GLITCHTIP_DSN found in environment - disabled');
}
