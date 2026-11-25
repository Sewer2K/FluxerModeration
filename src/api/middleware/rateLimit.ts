import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';
import { t } from '@/i18n';

function rateLimitT(key: string): string {
  return t('en', `auditCatalog.api.middleware.rateLimit.${key}`);
}

export const apiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: rateLimitT('tooManyRequests') },
});

export const authLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: rateLimitT('tooManyAuthRequests') },
});

export const writeLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: rateLimitT('tooManyWriteRequests') },
});

export const appealSubmitIpLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many appeal submissions. Try again later.' },
  keyGenerator: (req) => ipKeyGenerator(req.ip || 'unknown'),
});

export const appealSubmitTokenLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many appeal submissions. Try again later.' },
  keyGenerator: (req) => `appeal:${String(req.params.token ?? '')}`,
});
