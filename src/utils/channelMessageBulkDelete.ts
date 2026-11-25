import { Routes } from '@fluxerjs/types';
import { isArray } from './isArray';
import { Channel } from '@fluxerjs/core';

export const CHANNEL_MESSAGE_FETCH_LIMIT = 100;
export const CHANNEL_BULK_DELETE_LIMIT = 100;
export const MAX_CLEAR_AMOUNT = 1000;

type RestClient = {
  get: (url: string) => Promise<unknown>;
  delete: (url: string) => Promise<unknown>;
};

type BulkDeleteChannel = Pick<Channel, 'bulkDelete'>;

export async function fetchRecentChannelMessageIds(
  rest: RestClient,
  channelId: string,
  count: number,
): Promise<string[]> {
  const ids: string[] = [];
  let before: string | undefined;

  while (ids.length < count) {
    const pageSize = Math.min(CHANNEL_MESSAGE_FETCH_LIMIT, count - ids.length);
    const query = `limit=${pageSize}${before ? `&before=${before}` : ''}`;
    const data = await rest.get(`${Routes.channelMessages(channelId)}?${query}`);
    const messages = isArray(data) ? data.filter(Boolean) : [];
    if (messages.length === 0) break;

    for (const msg of messages) {
      const id = (msg as { id?: string })?.id;
      if (id) ids.push(id);
    }

    const oldest = messages[messages.length - 1] as { id?: string } | undefined;
    before = oldest?.id;
    if (!before || messages.length < pageSize) break;
  }

  return ids.slice(0, count);
}

async function deleteMessageChunk(
  rest: RestClient,
  channel: BulkDeleteChannel | null | undefined,
  channelId: string,
  messageIds: string[],
  onChunkError?: (error: unknown, messageId: string) => void,
): Promise<number> {
  if (messageIds.length === 0) return 0;

  if (messageIds.length === 1 && '0' in messageIds) {
    try {
      await rest.delete(Routes.channelMessage(channelId, messageIds[0]));
      return 1;
    } catch (error) {
      onChunkError?.(error, messageIds[0]);
      return 0;
    }
  }

  try {
    if (channel?.bulkDelete) {
      await channel.bulkDelete(messageIds);
      return messageIds.length;
    }
    throw new Error('bulk delete unavailable');
  } catch (bulkError) {
    let deleted = 0;
    for (const id of messageIds) {
      try {
        await rest.delete(Routes.channelMessage(channelId, id));
        deleted++;
      } catch (error) {
        onChunkError?.(error ?? bulkError, id);
      }
    }
    return deleted;
  }
}

export async function deleteChannelMessageIds(
  rest: RestClient,
  channel: BulkDeleteChannel | null | undefined,
  channelId: string,
  messageIds: string[],
  onChunkError?: (error: unknown, messageId: string) => void,
): Promise<number> {
  let deletedCount = 0;

  for (let i = 0; i < messageIds.length; i += CHANNEL_BULK_DELETE_LIMIT) {
    const chunk = messageIds.slice(i, i + CHANNEL_BULK_DELETE_LIMIT);
    deletedCount += await deleteMessageChunk(rest, channel, channelId, chunk, onChunkError);
  }

  return deletedCount;
}
