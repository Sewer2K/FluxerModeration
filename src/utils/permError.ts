import { t } from '@/i18n';

export function isPermDenied(error: unknown): boolean {
  if (!error) return false;
  return (
    error &&
    typeof error === 'object' &&
    (('code' in error && error.code === 50013) ||
      ('statusCode' in error && error.statusCode === 403) ||
      ('message' in error && typeof error.message === 'string' && /permissions?/i.test(error.message)))
  );
}

const PERM_MESSAGE_KEYS = {
  kick: 'auditCatalog.utils.permError.kick',
  ban: 'auditCatalog.utils.permError.ban',
  unban: 'auditCatalog.utils.permError.unban',
  timeout: 'auditCatalog.utils.permError.timeout',
  mute: 'auditCatalog.utils.permError.mute',
  unmute: 'auditCatalog.utils.permError.unmute',
  clear: 'auditCatalog.utils.permError.clear',
} as const;

export type PermMessageAction = keyof typeof PERM_MESSAGE_KEYS;

export function permMessage(locale: unknown, action: PermMessageAction): string {
  return t(locale, PERM_MESSAGE_KEYS[action]);
}
