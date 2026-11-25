jest.mock('@/utils/logger', () => ({
  logServerEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/utils/settingsCache', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));
jest.mock('@/utils/memberCounter', () => ({
  get: jest.fn(),
  fetchAndSetMemberCount: jest.fn(),
}));
jest.mock('@/utils/welcomeCard', () => ({
  generateWelcomeCard: jest.fn(),
}));
jest.mock('@/utils/isTextChannel', () => ({ isTextChannel: () => true }));

jest.mock('@/models/WelcomeMessageRecord', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) }),
  },
}));

const settingsCache = require('@/utils/settingsCache').default;
const memberCounter = require('@/utils/memberCounter');
const guildMemberUpdate = require('@/events/guildMemberUpdate').default;

export {};

describe('guildMemberUpdate welcome trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    memberCounter.get.mockReturnValue(42);
  });

  test('sends the welcome message for the verified role and resolves the channel through client.channels', async () => {
    const send = jest.fn().mockResolvedValue(undefined);

    settingsCache.get.mockResolvedValue({
      welcomeMessage: {
        enabled: true,
        channelId: 'welcome-channel',
        trigger: 'role',
        triggerRoleId: null,
        imageEnabled: false,
        message: 'Welcome {user} as {role}',
        embed: { enabled: false },
        card: {},
        showRole: true,
      },
      verification: {
        verifiedRoleId: 'verified-role',
      },
      autoroleId: 'autorole-id',
    });

    const guild = {
      id: 'g1',
      name: 'ClaudeCityMod Test Guild',
      channels: new Map(),
      roles: new Map([['verified-role', { id: 'verified-role', name: 'Verified' }]]),
    };

    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue({ send }),
      },
    };

    const oldMember = {
      id: 'u1',
      roles: { roleIds: [] },
    };

    const newMember = {
      id: 'u1',
      guild,
      roles: { roleIds: ['verified-role'] },
      displayName: 'User One',
      user: {
        username: 'userone',
        displayAvatarURL: jest.fn().mockReturnValue('https://cdn.example/avatar.png'),
      },
    };

    await guildMemberUpdate.execute(oldMember, newMember, client);

    expect(client.channels.fetch).toHaveBeenCalledWith('welcome-channel');
    expect(send).toHaveBeenCalledWith({ content: 'Welcome <@u1> as Verified', allowedMentions: { parse: ['users'] } });
  });

  test('bails quietly when oldMember is null (uncached previous state in v2)', async () => {
    const newMember = {
      id: 'u1',
      guild: { id: 'g1' },
      roles: { roleIds: ['r1'] },
    };

    await expect(guildMemberUpdate.execute(null, newMember, {})).resolves.toBeUndefined();
    expect(settingsCache.get).not.toHaveBeenCalled();
  });
});
