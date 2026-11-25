jest.mock('@/utils/settingsCache', () => ({
  get: jest.fn(),
}));

jest.mock('@/utils/permissions', () => ({
  canModerate: jest.fn(() => ({ canModerate: true, reason: null })),
}));

jest.mock('@/utils/logger', () => ({
  logModAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/models/ModerationLog', () => ({
  logAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/models/TempBan', () => ({
  create: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/utils/welcomeMessageStore', () => ({
  purgeWelcomeMessage: jest.fn().mockResolvedValue(undefined),
}));

import settingsCache from '@/utils/settingsCache';
import banCommand, { parsePurgeDays } from '@/commands/moderation/ban';
import { parseMassbanArgs } from '@/commands/moderation/massban';

const settingsCacheMock = settingsCache as unknown as { get: jest.Mock };
type BanExecuteArgs = Parameters<typeof banCommand.execute>;

function makeBanContext() {
  const targetId = '1472055467356586113';
  const moderatorId = '1472055467356586114';
  const target = {
    id: targetId,
    user: { id: targetId, username: 'spammer' },
  };
  const moderator = { id: moderatorId };
  const guild = {
    id: 'guild',
    name: 'Test Server',
    members: {
      get: jest.fn((id: string) => (id === target.id ? target : id === moderator.id ? moderator : null)),
    },
    ban: jest.fn().mockResolvedValue(undefined),
  };
  const message = {
    guild,
    author: { id: moderator.id, username: 'moderator' },
    reply: jest.fn().mockResolvedValue({}),
  };
  const client = {
    user: null,
    users: {
      fetch: jest.fn(),
    },
  };

  return { guild, message, client };
}

describe('ban purge controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsCacheMock.get.mockResolvedValue({ language: 'en' });
  });

  test('parses supported purge windows', () => {
    expect(parsePurgeDays('1d')).toBe(1);
    expect(parsePurgeDays('7D')).toBe(7);
    expect(parsePurgeDays('3h')).toBeNull();
    expect(parsePurgeDays('8d')).toBeNull();
  });

  test('does not purge messages by default', async () => {
    const { guild, message, client } = makeBanContext();

    await banCommand.execute(
      message as unknown as BanExecuteArgs[0],
      ['1472055467356586113'],
      client as unknown as BanExecuteArgs[2],
    );

    expect(guild.ban).toHaveBeenCalledTimes(1);
    expect(guild.ban.mock.calls[0][1]).not.toHaveProperty('deleteMessageDays');
  });

  test('purges one day when purge is requested without a window', async () => {
    const { guild, message, client } = makeBanContext();

    await banCommand.execute(
      message as unknown as BanExecuteArgs[0],
      ['purge', '1472055467356586113'],
      client as unknown as BanExecuteArgs[2],
    );

    expect(guild.ban.mock.calls[0][1]).toMatchObject({ deleteMessageDays: 1 });
  });

  test('purges the requested number of days', async () => {
    const { guild, message, client } = makeBanContext();

    await banCommand.execute(
      message as unknown as BanExecuteArgs[0],
      ['purge=3d', '1472055467356586113', 'raid'],
      client as unknown as BanExecuteArgs[2],
    );

    expect(guild.ban.mock.calls[0][1]).toMatchObject({ deleteMessageDays: 3 });
    expect(guild.ban.mock.calls[0][1].reason).toContain('message history purged');
  });

  test('rejects unsupported purge windows', async () => {
    const { guild, message, client } = makeBanContext();

    await banCommand.execute(
      message as unknown as BanExecuteArgs[0],
      ['purge=3h', '1472055467356586113'],
      client as unknown as BanExecuteArgs[2],
    );

    expect(guild.ban).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Invalid purge window'));
  });
});

describe('massban purge controls', () => {
  test('keeps the default purge behavior', () => {
    expect(parseMassbanArgs(['start', 'end'])).toEqual({
      purgeMessages: true,
      args: ['start', 'end'],
    });
  });

  test('removes the nopurge option from command arguments', () => {
    expect(parseMassbanArgs(['nopurge', 'start', 'end', 'evidence'])).toEqual({
      purgeMessages: false,
      args: ['start', 'end', 'evidence'],
    });
  });
});
