jest.mock('pidusage', () => jest.fn().mockResolvedValue({ cpu: 12.3 }));

import command from '@/commands/owner/stats';
import logBuffer from '@/services/LogBuffer';

function makeClient() {
  const guild = {
    memberCount: 123,
    members: new Map([['member-1', {}]]),
    channels: new Map([
      ['text-1', { type: 0 }],
      ['voice-1', { type: 2 }],
      ['category-1', { type: 4 }],
    ]),
    roles: new Map([['role-1', {}]]),
    emojis: new Map([['emoji-1', {}]]),
    stickers: new Map(),
  };

  return {
    user: { id: 'bot-1' },
    readyAt: new Date(),
    _ws: { ping: 42 },
    guilds: new Map([['guild-1', guild]]),
    users: new Map([
      ['user-1', {}],
      ['user-2', {}],
    ]),
    channels: new Map([['channel-1', {}]]),
  } as any;
}

function makeMessage() {
  const edit = jest.fn().mockResolvedValue(undefined);
  return {
    author: { id: 'owner-1' },
    reply: jest.fn().mockResolvedValue({ edit }),
    edit,
  } as any;
}

describe('owner stats command', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    logBuffer.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    logBuffer.clear();
  });

  test('is owner-only and edits one snapshot every 10 seconds for 30 seconds', async () => {
    expect(command.name).toBe('stats');
    expect(command.ownerOnly).toBe(true);
    expect(command.allowDM).toBe(true);

    logBuffer.push('error', 'test', 'example failure');
    const message = makeMessage();

    await command.execute(message, [], makeClient(), '!');

    expect(message.reply).toHaveBeenCalledTimes(1);
    const firstEmbed = message.reply.mock.calls[0][0].embeds[0].toJSON();
    expect(firstEmbed.title).toContain('Stats Snapshot');
    expect(firstEmbed.description).toBeNull();
    expect(firstEmbed.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Overview', value: expect.stringContaining('Servers: `1`') }),
        expect.objectContaining({ name: 'Logs', value: expect.stringContaining('Errors/fatals: `1`') }),
      ]),
    );

    await jest.advanceTimersByTimeAsync(10_000);
    expect(message.edit).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(20_000);
    expect(message.edit).toHaveBeenCalledTimes(3);

    await jest.advanceTimersByTimeAsync(10_000);
    expect(message.edit).toHaveBeenCalledTimes(3);
  });
});
