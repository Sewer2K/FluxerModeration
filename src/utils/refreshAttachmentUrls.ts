import type { Client } from '@fluxerjs/core';
import { isArray } from '@/utils/isArray';

const REFRESH_ROUTE = '/attachments/refresh-urls';
const BATCH_SIZE = 50;
const REFRESH_WINDOW_MS = 60 * 60 * 1000;

type AttachmentRefreshRest = Pick<Client['rest'], 'post'>;

export function attachmentUrlNeedsRefresh(url: string, now = Date.now()): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (!parsed.pathname.includes('/attachments/')) return false;
  if (parsed.searchParams.get('uc') === 'dp') return false;

  const ex = parsed.searchParams.get('ex');
  if (!ex) return true;

  const expiresAt = Number.parseInt(ex, 16);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt * 1000 <= now + REFRESH_WINDOW_MS;
}

export async function refreshAttachmentUrls(
  rest: AttachmentRefreshRest,
  urls: readonly string[],
  now = Date.now(),
): Promise<Map<string, string>> {
  const refreshed = new Map<string, string>();
  const unique = [...new Set(urls.filter((url) => attachmentUrlNeedsRefresh(url, now)))];

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const response = (await rest.post(REFRESH_ROUTE, {
      body: { attachment_urls: batch },
    })) as { refreshed_urls?: Array<{ original?: string; refreshed?: string }> };

    const results = response.refreshed_urls;
    if (!isArray(results)) continue;
    for (const entry of results) {
      if (typeof entry.original === 'string' && typeof entry.refreshed === 'string') {
        refreshed.set(entry.original, entry.refreshed);
      }
    }
  }

  return refreshed;
}

export function applyRefreshedAttachmentUrls<T extends { attachments?: Array<{ url: string; name: string }> }>(
  messages: T[],
  refreshed: ReadonlyMap<string, string>,
): T[] {
  if (refreshed.size === 0) return messages;
  return messages.map((message) => {
    const attachments = message.attachments;
    if (!attachments?.length) return message;
    return {
      ...message,
      attachments: attachments.map((attachment) => ({
        ...attachment,
        url: refreshed.get(attachment.url) ?? attachment.url,
      })),
    };
  });
}

export async function refreshTranscriptAttachments<T extends { attachments?: Array<{ url: string; name: string }> }>(
  rest: AttachmentRefreshRest,
  messages: T[],
): Promise<T[]> {
  const urls = messages.flatMap((message) => (message.attachments ?? []).map((attachment) => attachment.url));
  if (urls.length === 0) return messages;
  try {
    return applyRefreshedAttachmentUrls(messages, await refreshAttachmentUrls(rest, urls));
  } catch {
    return messages;
  }
}
