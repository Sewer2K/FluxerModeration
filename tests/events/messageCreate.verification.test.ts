jest.mock('@/utils/settingsCache', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

jest.mock('@/utils/serviceBlockCache', () => ({
  isBlocked: jest.fn().mockResolvedValue(false),
  isGuildBlocked: jest.fn().mockResolvedValue(false),
  shouldSendTerminationNotice: jest.fn().mockReturnValue(true),
  terminationNotice: jest.fn(),
}));

jest.mock('@/utils/messageCache', () => ({
  store: jest.fn(),
}));

jest.mock('@/utils/messageLogContent', () => ({
  formatMessageLogContent: jest.fn().mockReturnValue(null),
}));

jest.mock('@/models/Ticket', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: jest.fn(),
  },
}));

jest.mock('@/utils/dmCoordinator', () => ({
  requestDMProcess: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/utils/roleQueue', () => ({
  enqueue: jest.fn(),
}));

jest.mock('@/utils/stickyMessage', () => ({
  handleStickyOnMessage: jest.fn(),
}));

jest.mock('@/automod', () => ({
  __esModule: true,
  default: {
    process: jest.fn(),
  },
}));

jest.mock('@/automod/modules/ghostPing', () => ({
  __esModule: true,
  default: {
    storeMessage: jest.fn(),
  },
}));

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

import type { Client, Guild, Message } from '@fluxerjs/core';
import settingsCache from '@/utils/settingsCache';
import { hashVerificationCode, removeVerificationSession, verificationSessions } from '@/commands/admin/verify';
import messageCreate from '@/events/messageCreate';

const mockedSettingsCache = settingsCache as unknown as { get: jest.Mock };

describe('messageCreate verification', () => {
  afterEach(async () => {
    for (const channelId of [...verificationSessions.keys()]) {
      await removeVerificationSession(channelId);
    }
    jest.clearAllMocks();
  });

  test('does not report success when the verified role cannot be added', async () => {
    const addRole = jest.fn().mockRejectedValue({ statusCode: 403 });
    const member = { roles: { add: addRole } };
    const guild = {
      id: 'guild-1',
      name: 'Test Guild',
      members: new Map([['user-1', member]]),
      channels: new Map(),
      fetchMember: jest.fn().mockResolvedValue(member),
    } as unknown as Guild;
    const reply = jest.fn().mockResolvedValue(undefined);
    const message = {
      id: 'message-1',
      guildId: 'guild-1',
      guild,
      channelId: 'verification-1',
      author: { id: 'user-1', bot: false },
      content: 'RKCBYA',
      reply,
    } as unknown as Message;
    const client = {
      user: { id: 'bot-1' },
      guilds: {
        get: jest.fn().mockReturnValue(guild),
        fetch: jest.fn().mockResolvedValue(guild),
      },
      channels: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as unknown as Client;

    mockedSettingsCache.get.mockResolvedValue({
      language: 'en',
      verification: {
        verifiedRoleId: 'role-1',
        logChannelId: null,
      },
      autoroleId: null,
    });
    verificationSessions.set('verification-1', {
      guildId: 'guild-1',
      channelId: 'verification-1',
      userId: 'user-1',
      codeHash: hashVerificationCode('RKCBYA'),
      attempts: 0,
      maxAttempts: 2,
      panelChannelId: '',
      panelMessageId: '',
      expiresAt: Date.now() + 60_000,
      timeout: setTimeout(() => {}, 60_000),
    });

    const execute = messageCreate.execute as unknown as (message: Message, client: Client) => Promise<void>;
    await execute(message, client);

    expect(addRole).toHaveBeenCalledWith('role-1');
    expect(reply).toHaveBeenCalledTimes(1);
    const embed = reply.mock.calls[0]?.[0]?.embeds?.[0];
    expect(embed?.toJSON?.().title).toBe('Verification could not be completed');
    expect(verificationSessions.has('verification-1')).toBe(true);
  });
});
