import type { Client, Guild } from '@fluxerjs/core';
import { lockInvitesForRaid, restoreRaidInviteLocks } from '@/utils/raidDetector';

const mockFind = jest.fn();
const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();

jest.mock('@/models/GuildSettings', () => ({
  __esModule: true,
  default: {
    find: (...args: unknown[]) => mockFind(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
  },
}));
jest.mock('@/utils/settingsCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn() },
}));
jest.mock('@/utils/logger', () => ({
  logServerEvent: jest.fn().mockResolvedValue(undefined),
}));

function makeClient(features: string[]): Client {
  return {
    rest: {
      get: jest.fn().mockResolvedValue({ features }),
      patch: jest.fn().mockResolvedValue(undefined),
    },
    guilds: { get: jest.fn().mockReturnValue({ id: 'guild-1', name: 'Test Server' }) },
  } as unknown as Client;
}

describe('raid invite lock recovery', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mockUpdateOne.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('persists the unlock deadline before disabling invites', async () => {
    const client = makeClient([]);
    const guild = { id: 'guild-1' } as Guild;

    await lockInvitesForRaid(client, guild);

    expect(mockUpdateOne).toHaveBeenCalledWith(
      { guildId: 'guild-1' },
      {
        $set: {
          raidInvitesWereDisabled: true,
          raidInviteUnlockAt: expect.any(Date),
        },
      },
      { upsert: true },
    );
    expect(client.rest.patch).toHaveBeenCalled();
  });

  test('restores an expired persisted lock after startup', async () => {
    const client = makeClient(['INVITES_DISABLED']);
    const unlockAt = new Date(Date.now() - 1_000);
    mockFind.mockReturnValue({
      lean: jest
        .fn()
        .mockResolvedValue([{ guildId: 'guild-1', raidInvitesWereDisabled: true, raidInviteUnlockAt: unlockAt }]),
    });
    mockFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        guildId: 'guild-1',
        raidInvitesWereDisabled: true,
        raidInviteUnlockAt: unlockAt,
      }),
    });

    await restoreRaidInviteLocks(client);
    await jest.advanceTimersByTimeAsync(0);

    expect(client.rest.patch).toHaveBeenCalledWith('/guilds/guild-1', {
      body: { features: [] },
    });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { guildId: 'guild-1' },
      { $set: { raidInvitesWereDisabled: false, raidInviteUnlockAt: null } },
    );
  });
});
