import type { MessageSendOptions } from '@fluxerjs/core';
import isNetworkError from './isNetworkError';
import { sendMessage, type MessageSendTarget } from './sendMessage';

const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 3000];

export async function retrySend(channel: MessageSendTarget, opts: MessageSendOptions, _label = 'message') {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await sendMessage(channel, opts);
    } catch (err: unknown) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isNetworkError(err)) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt] || 2000));
        continue;
      }
      break;
    }
  }
  throw new Error(`Retry ${MAX_RETRIES} failed: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}
