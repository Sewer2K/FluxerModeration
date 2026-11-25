jest.mock('@/config', () => ({
  ownerId: 'owner123',
}));
jest.mock('@/models/ModerationLog', () => ({
  logAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/utils/logger', () => ({
  logModAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/utils/isNetworkError', () => jest.fn(() => false));
jest.mock('@/utils/settingsCache', () => ({
  __esModule: true,
  default: { get: jest.fn().mockResolvedValue(null) },
}));

import command from '@/commands/moderation/unban';
import isNetworkError from '@/utils/isNetworkError';

const isNetworkErrorMock = isNetworkError as jest.Mock;

function makeGuild(unbanImpl: (userId: string) => Promise<void>) {
  return {
    id: 'guild123',
    name: 'Test Server',
    unban: jest.fn(unbanImpl),
  };
}

function makeMessage(guild: unknown) {
  const replies: string[] = [];
  return {
    guild,
    guildId: 'guild123',
    author: { id: 'mod1', username: 'mod' },
    reply: jest.fn((content: string) => {
      replies.push(content);
      return Promise.resolve();
    }),
    replies,
  };
}

const client = {
  users: { fetch: jest.fn().mockRejectedValue(new Error('unknown user')) },
  guilds: { fetch: jest.fn() },
};

// what the Fluxer API returns when unbanning a user who isn't banned
const notBannedError = Object.assign(new Error('Invalid form body.'), {
  code: 'INVALID_FORM_BODY',
  statusCode: 400,
  errors: [{ path: 'user_id', message: 'USER_IS_NOT_BANNED', code: 'USER_IS_NOT_BANNED' }],
});

describe('!unban', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isNetworkErrorMock.mockReturnValue(false);
  });

  test('treats USER_IS_NOT_BANNED as "not banned" instead of a generic error', async () => {
    const guild = makeGuild(() => Promise.reject(notBannedError));
    const message = makeMessage(guild);

    await command.execute(message as never, ['123456789012345678'], client as never, '!');

    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(message.replies[0]).toContain('not banned');
  });

  test('still handles perm errors', async () => {
    const permError = Object.assign(new Error("You don't have the permissions"), { statusCode: 403 });
    const guild = makeGuild(() => Promise.reject(permError));
    const message = makeMessage(guild);

    await command.execute(message as never, ['123456789012345678'], client as never, '!');

    expect(message.replies[0]).toContain('permission');
  });
});
