import type { Client } from '@fluxerjs/core';
import type { ITempBan } from '@/models/TempBan';
import { executeTempBanExpiry, scheduleTempBanExpiries } from '@/services/TempBanRecovery';

const mockFind = jest.fn();
const mockDeleteOne = jest.fn();

jest.mock('@/models/TempBan', () => ({
  __esModule: true,
  default: {
    find: (...args: unknown[]) => mockFind(...args),
    deleteOne: (...args: unknown[]) => mockDeleteOne(...args),
  },
}));
jest.mock('@/config', () => ({
  __esModule: true,
  default: { branding: { publicName: 'ClaudeCityMod' } },
}));
jest.mock('@/utils/logger', () => ({
  logModAction: jest.fn().mockResolvedValue(undefined),
}));

function makeEntry(expiresAt: Date): ITempBan {
  return {
    _id: 'ban-1',
    guildId: 'guild-1',
    userId: 'user-1',
    moderatorId: 'moderator-1',
    reason: 'test',
    expiresAt,
  } as unknown as ITempBan;
}

function makeClient(guild: { unban: jest.Mock } | null): Client {
  return {
    user: { id: 'bot-1' },
    guilds: {
      get: jest.fn().mockReturnValue(guild),
      fetch: jest.fn().mockResolvedValue(guild),
    },
  } as unknown as Client;
}

describe('temporary ban recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFind.mockResolvedValue([]);
    mockDeleteOne.mockResolvedValue(undefined);
  });

  test('loads expired records instead of skipping them during startup', async () => {
    const entry = makeEntry(new Date(Date.now() - 1_000));
    mockFind.mockResolvedValue([entry]);

    await scheduleTempBanExpiries(makeClient({ unban: jest.fn().mockResolvedValue(undefined) }));

    expect(mockFind).toHaveBeenCalledWith({});
  });

  test('deletes the record only after an unban succeeds', async () => {
    const guild = { unban: jest.fn().mockResolvedValue(undefined) };
    const entry = makeEntry(new Date(Date.now() - 1_000));

    await executeTempBanExpiry(entry, makeClient(guild));

    expect(guild.unban).toHaveBeenCalledWith('user-1');
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: 'ban-1' });
  });

  test('keeps the record when unban fails', async () => {
    jest.useFakeTimers();
    const guild = { unban: jest.fn().mockRejectedValue(new Error('Missing Permissions')) };
    const entry = makeEntry(new Date(Date.now() - 1_000));

    await executeTempBanExpiry(entry, makeClient(guild));

    expect(mockDeleteOne).not.toHaveBeenCalled();
    jest.clearAllTimers();
    jest.useRealTimers();
  });
});
