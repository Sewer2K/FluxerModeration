jest.mock('@fluxerjs/types', () => ({
  ...jest.requireActual('@fluxerjs/types'),
  Routes: {
    channelMessage: (channelId: string, msgId: string) => `/channels/${channelId}/messages/${msgId}`,
  },
}));

describe('antiSpam - execute channel fallback (CCM-2T)', () => {
  let antiSpam: any;

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    antiSpam = require('@/automod/modules/antiSpam').default;
  });

  test('sends the warning through the fetched channel when message.channel is null', async () => {
    const send = jest.fn().mockResolvedValue({ delete: jest.fn().mockResolvedValue(undefined) });
    const fallbackChannel = {
      id: 'c1',
      isTextBased: () => true,
      isDM: () => false,
      send,
    };
    const guild = {
      id: 'g1',
      channels: { get: (id: string) => (id === 'c1' ? fallbackChannel : undefined) },
      members: { get: () => null },
      fetchMember: jest.fn().mockResolvedValue(null),
    };

    const message = {
      id: 'm1',
      author: { id: 'u1' },
      guildId: 'g1',
      guild,
      channel: null, // v2 payloads can have a null channel
      channelId: 'c1',
    };

    const client = {
      rest: { delete: jest.fn().mockResolvedValue(undefined) },
      channels: { fetch: jest.fn().mockResolvedValue(null) },
    };

    const settings = {};
    const automodSettings = {};
    const spamResult = { isSpam: true, messageIds: ['m0', 'm1'], count: 0 };
    const config = {
      maxMessages: 5,
      timeWindow: 5000,
      timeoutDuration: 600000,
      violationThreshold: 3,
      violationWindow: 1800000,
    };

    await antiSpam.execute(message, client, settings, automodSettings, spamResult, config);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].content).toContain('u1');
  });
});
