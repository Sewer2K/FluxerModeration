import { isArray } from '@/utils/isArray';

// Fluxer API errors carry field-level details in `errors` (path + code/message);
// the top-level message is often just "Invalid form body." which is useless in logs
function fieldErrorDetails(error: object): string | null {
  if (!('errors' in error)) return null;
  const errors = (error as { errors?: unknown }).errors;
  if (!isArray(errors) || errors.length === 0) return null;

  const details: string[] = [];
  for (const entry of errors) {
    if (!entry || typeof entry !== 'object') continue;
    const path = 'path' in entry && typeof entry.path === 'string' ? entry.path : null;
    const code = 'code' in entry && typeof entry.code === 'string' ? entry.code : null;
    const text = 'message' in entry && typeof entry.message === 'string' ? entry.message : null;
    const detail = [path, code ?? text].filter(Boolean).join(': ');
    if (detail) details.push(detail);
  }
  return details.length > 0 ? details.join(', ') : null;
}

export function messageFromError(error: unknown): string | unknown;
export function messageFromError<Fallback>(error: unknown, fallback: Fallback): string | Fallback;
export function messageFromError(error: unknown, fallback = error) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    const details = fieldErrorDetails(error);
    return details ? `${error.message} [${details}]` : error.message;
  }
  return fallback;
}
