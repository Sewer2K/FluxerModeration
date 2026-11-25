jest.mock('@/models/VerificationSession', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
    deleteOne: jest.fn().mockResolvedValue(null),
    find: jest.fn(),
  },
}));

jest.mock('@/utils/captchaCard', () => ({
  generateCaptcha: jest.fn(),
}));

import type { Client } from '@fluxerjs/core';
import VerificationSessionModel from '@/models/VerificationSession';
import {
  hashVerificationCode,
  registerVerificationSession,
  removeVerificationSession,
  restoreVerificationSessions,
  verificationSessions,
} from '@/commands/admin/verify';

const model = VerificationSessionModel as unknown as {
  findOneAndUpdate: jest.Mock;
  deleteOne: jest.Mock;
  find: jest.Mock;
};

function makeClient(channels: Record<string, unknown> = {}): Client {
  return {
    channels: {
      fetch: jest.fn((channelId: string) => Promise.resolve(channels[channelId] ?? null)),
    },
    rest: {
      delete: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as Client;
}

function makeGuildChannel(): {
  isVoice: () => boolean;
  isLink: () => boolean;
  isTextBased: () => boolean;
  isDM: () => boolean;
  delete: jest.Mock;
} {
  return {
    isVoice: () => false,
    isLink: () => false,
    isTextBased: () => true,
    isDM: () => false,
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

describe('verification session persistence', () => {
  afterEach(async () => {
    for (const channelId of [...verificationSessions.keys()]) {
      await removeVerificationSession(channelId);
    }
    jest.clearAllMocks();
  });

  test('stores only a hash and restores the runtime expiry timer', async () => {
    const client = makeClient();

    await registerVerificationSession(client, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      userId: 'user-1',
      code: 'rkcbya',
      maxAttempts: 2,
      panelChannelId: 'panel-channel',
      panelMessageId: 'panel-message',
      expiresAt: Date.now() + 60_000,
    });

    const session = verificationSessions.get('channel-1');
    expect(session?.codeHash).toBe(hashVerificationCode('RKCBYA'));
    expect(session && 'code' in session).toBe(false);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { channelId: 'channel-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          codeHash: hashVerificationCode('RKCBYA'),
          expiresAt: expect.any(Date),
        }),
      }),
      expect.objectContaining({ upsert: true }),
    );
  });

  test('restores live sessions and cleans expired channels', async () => {
    const expiredChannel = makeGuildChannel();
    const pendingChannel = makeGuildChannel();
    const client = makeClient({
      'expired-channel': expiredChannel,
      'pending-channel': pendingChannel,
    });
    const now = Date.now();
    const expired = {
      _id: 'expired-session',
      guildId: 'guild-1',
      channelId: 'expired-channel',
      userId: 'user-1',
      panelChannelId: 'panel-channel',
      panelMessageId: 'panel-message',
      codeHash: hashVerificationCode('EXPIRED'),
      attempts: 0,
      maxAttempts: 2,
      expiresAt: new Date(now - 1_000),
    };
    const pending = {
      _id: 'pending-session',
      guildId: 'guild-1',
      channelId: 'pending-channel',
      userId: 'user-2',
      panelChannelId: '',
      panelMessageId: '',
      codeHash: hashVerificationCode('PENDING'),
      attempts: 1,
      maxAttempts: 2,
      expiresAt: new Date(now + 60_000),
    };

    model.find.mockResolvedValueOnce([expired]).mockResolvedValueOnce([pending]);

    await restoreVerificationSessions(client);

    expect(expiredChannel.delete).toHaveBeenCalledTimes(1);
    expect(verificationSessions.get('pending-channel')).toMatchObject({
      userId: 'user-2',
      codeHash: hashVerificationCode('PENDING'),
      attempts: 1,
    });
    expect(model.deleteOne).toHaveBeenCalledWith({ _id: 'expired-session' });
  });
});
