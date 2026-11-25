import type { Request, Response, NextFunction } from 'express';
import { t } from '@/i18n';
import { messageFromError } from '@/utils/messageFromError';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const errorMessage = messageFromError(err);
  console.error('[API Error]', errorMessage);

  let status: number;
  if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number' && err.status) {
    status = err.status;
  } else if (
    err &&
    typeof err === 'object' &&
    'statusCode' in err &&
    typeof err.statusCode === 'number' &&
    err.statusCode
  ) {
    status = err.statusCode;
  } else {
    status = 500;
  }

  const message =
    status >= 500
      ? t('en', 'auditCatalog.api.errors.internalServer')
      : errorMessage || t('en', 'auditCatalog.api.errors.generic');
  res.status(status).json({ error: message });
}
