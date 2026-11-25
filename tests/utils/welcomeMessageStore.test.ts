'use strict';

jest.mock('@/models/WelcomeMessageRecord', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
    findOneAndDelete: jest.fn(),
  },
}));

import WelcomeMessageRecord from '@/models/WelcomeMessageRecord';
import { purgeWelcomeMessage, recordWelcomeMessage } from '@/utils/welcomeMessageStore';
import type { Client } from '@fluxerjs/core';

const model = WelcomeMessageRecord as any;

describe('welcomeMessageStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('recordWelcomeMessage upserts guild/user mapping', async () => {
    await recordWelcomeMessage('g1', 'u1', 'c1', 'm1');

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { guildId: 'g1', userId: 'u1' },
      { guildId: 'g1', userId: 'u1', channelId: 'c1', messageId: 'm1' },
      { upsert: true, setDefaultsOnInsert: true },
    );
  });

  test('purgeWelcomeMessage deletes channel message and record', async () => {
    model.findOneAndDelete.mockResolvedValue({
      channelId: 'c1',
      messageId: 'm1',
    });

    const client = {
      rest: {
        delete: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as Client;

    const ok = await purgeWelcomeMessage(client, 'g1', 'u1');

    expect(ok).toBe(true);
    expect(client.rest.delete).toHaveBeenCalled();
    expect(model.findOneAndDelete).toHaveBeenCalledWith({ guildId: 'g1', userId: 'u1' });
  });

  test('purgeWelcomeMessage returns false when no record exists', async () => {
    model.findOneAndDelete.mockResolvedValue(null);

    const client = { rest: { delete: jest.fn() } } as unknown as Client;
    const ok = await purgeWelcomeMessage(client, 'g1', 'u1');

    expect(ok).toBe(false);
    expect(client.rest.delete).not.toHaveBeenCalled();
  });
});
