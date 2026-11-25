'use strict';

import { Routes } from '@fluxerjs/types';
import {
  CHANNEL_BULK_DELETE_LIMIT,
  CHANNEL_MESSAGE_FETCH_LIMIT,
  deleteChannelMessageIds,
  fetchRecentChannelMessageIds,
} from '@/utils/channelMessageBulkDelete';

describe('fetchRecentChannelMessageIds', () => {
  test('paginates with before until count is reached', async () => {
    const page1 = Array.from({ length: CHANNEL_MESSAGE_FETCH_LIMIT }, (_, i) => ({
      id: `msg-${i}`,
    }));
    const page2 = [{ id: 'msg-100' }];

    const get = jest.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const ids = await fetchRecentChannelMessageIds({ get, delete: jest.fn() }, 'chan-1', 101);

    expect(ids).toHaveLength(101);
    expect(ids[0]).toBe('msg-0');
    expect(ids[100]).toBe('msg-100');
    expect(get).toHaveBeenNthCalledWith(1, `${Routes.channelMessages('chan-1')}?limit=${CHANNEL_MESSAGE_FETCH_LIMIT}`);
    expect(get).toHaveBeenNthCalledWith(2, `${Routes.channelMessages('chan-1')}?limit=1&before=msg-99`);
  });

  test('returns exactly amount ids for clear 100', async () => {
    const page = Array.from({ length: CHANNEL_MESSAGE_FETCH_LIMIT }, (_, i) => ({
      id: `msg-${i}`,
    }));
    const get = jest.fn().mockResolvedValue(page);

    const ids = await fetchRecentChannelMessageIds({ get, delete: jest.fn() }, 'chan-1', 100);

    expect(ids).toHaveLength(100);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('deleteChannelMessageIds', () => {
  test('bulk deletes in chunks of 100', async () => {
    const messageIds = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    const bulkDelete = jest.fn().mockResolvedValue(undefined);
    const rest = { get: jest.fn(), delete: jest.fn() };

    const deleted = await deleteChannelMessageIds(rest, { bulkDelete }, 'chan-1', messageIds);

    expect(deleted).toBe(150);
    expect(bulkDelete).toHaveBeenCalledTimes(2);
    expect(bulkDelete.mock.calls[0][0]).toHaveLength(CHANNEL_BULK_DELETE_LIMIT);
    expect(bulkDelete.mock.calls[1][0]).toHaveLength(50);
  });
});
