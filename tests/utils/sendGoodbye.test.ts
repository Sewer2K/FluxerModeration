jest.mock('@/utils/memberCounter', () => ({
  get: jest.fn(() => 99),
}));

jest.mock('@/utils/channelSend', () => ({
  resolveGuildChannel: jest.fn(),
  sendWithPermRefresh: jest.fn().mockResolvedValue(undefined),
}));

const { resolveGuildChannel, sendWithPermRefresh } = require('@/utils/channelSend');
const sendGoodbye = require('@/utils/sendGoodbye').default;

export {};

describe('sendGoodbye', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolves channel and sends via permission-aware send', async () => {
    const channel = { send: jest.fn().mockResolvedValue(undefined) };
    resolveGuildChannel.mockResolvedValue(channel);
    const client = { channels: { fetch: jest.fn() } };
    const guild = {
      id: 'g1',
      name: 'Test Guild',
      channels: new Map(),
    };
    const member = {
      id: 'u1',
      user: { username: 'leaver' },
    };
    const settings = {
      goodbyeMessage: {
        enabled: true,
        channelId: 'goodbye-ch',
        message: 'Bye {user}',
        embed: { enabled: false },
      },
    };

    await sendGoodbye(member, guild, settings, client);

    expect(resolveGuildChannel).toHaveBeenCalledWith(guild, 'goodbye-ch', client);
    expect(sendWithPermRefresh).toHaveBeenCalledWith(
      guild,
      'goodbye-ch',
      channel,
      { content: 'Bye <@u1>', allowedMentions: { parse: ['users'] } },
      client,
    );
  });

  test('sanitizes @everyone/@here in username and restricts allowedMentions', async () => {
    const channel = { send: jest.fn().mockResolvedValue(undefined) };
    resolveGuildChannel.mockResolvedValue(channel);
    const client = { channels: { fetch: jest.fn() } };
    const guild = { id: 'g1', name: 'Test Guild', channels: new Map() };
    const member = {
      id: 'u1',
      user: { username: 'evil@everyone and @here' },
    };
    const settings = {
      goodbyeMessage: {
        enabled: true,
        channelId: 'goodbye-ch',
        message: 'Bye {username}',
        embed: { enabled: false },
      },
    };

    await sendGoodbye(member, guild, settings, client);

    const sendOpts = sendWithPermRefresh.mock.calls[0][3];
    expect(sendOpts.allowedMentions).toEqual({ parse: ['users'] });
    expect(sendOpts.content).not.toMatch(/@(everyone|here)/i);
    expect(sendOpts.content).toContain('evil@');
    expect(sendOpts.content).toContain('\u200B');
    expect(sendOpts.content).toBe('Bye evil@\u200Beveryone and @\u200Bhere');
  });
});
