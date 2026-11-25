jest.mock('@/automod', () => ({
  __esModule: true,
  default: { handleGhostPing: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@/utils/logger', () => ({
  logServerEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/utils/settingsCache', () => ({
  __esModule: true,
  default: { get: jest.fn().mockResolvedValue(null) },
}));
jest.mock('@/utils/messageCache', () => ({
  get: jest.fn().mockReturnValue(null),
  remove: jest.fn(),
}));
jest.mock('@/models/StarboardMessage', () => ({
  __esModule: true,
  default: {
    find: jest.fn().mockResolvedValue([]),
  },
}));

const { logServerEvent } = require('@/utils/logger');
const messageDelete = require('@/events/messageDelete').default;

export {};

describe('messageDelete (fluxer.js v2 payload)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not throw when author is missing (plain MESSAGE_DELETE object)', async () => {
    const guild = { id: 'g1' };
    const channel = {
      id: 'c1',
      guildId: 'g1',
      isTextBased: () => true,
      isDM: () => false,
      guild: null,
    };
    const client = {
      guilds: { get: jest.fn().mockReturnValue(guild) },
      channels: { fetch: jest.fn() },
    };

    // shape emitted by @fluxerjs/core MESSAGE_DELETE — no Message instance, no author
    const payload = {
      id: 'm1',
      channelId: 'c1',
      channel,
      content: null,
      authorId: null,
    };

    await expect(messageDelete.execute(payload, client)).resolves.toBeUndefined();

    expect(logServerEvent).toHaveBeenCalled();
    const fields = logServerEvent.mock.calls[0][3];
    expect(fields.find((f: { name: string }) => f.name === 'Author').value).toBe('*(unknown)*');
  });

  test('uses authorId when present on the delete payload', async () => {
    const guild = { id: 'g1' };
    const channel = {
      id: 'c1',
      guildId: 'g1',
      isTextBased: () => true,
      isDM: () => false,
    };
    const client = {
      guilds: { get: jest.fn().mockReturnValue(guild) },
      channels: { fetch: jest.fn() },
    };

    await messageDelete.execute({ id: 'm2', channelId: 'c1', channel, content: 'hi', authorId: 'u99' }, client);

    const fields = logServerEvent.mock.calls[0][3];
    expect(fields.find((f: { name: string }) => f.name === 'Author').value).toBe('<@u99>');
  });
});
