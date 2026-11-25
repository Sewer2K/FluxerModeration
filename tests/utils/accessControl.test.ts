const mockConfig: any = {
  ownerId: 'owner-1',
  access: {
    allowedGuildId: null,
    dashboardAllowedUserIds: [],
  },
};

jest.mock('@/config', () => ({
  __esModule: true,
  default: mockConfig,
}));

import {
  allowedGuildId,
  isGuildAllowed,
  isDashboardUserAllowlisted,
  canAccessDashboard,
  clearDashboardAccessCache,
  enforceGuildLock,
  rejectGuildIfUnauthorized,
} from '@/utils/accessControl';

function setLock(guildId: string | null, extraUsers: string[] = []) {
  mockConfig.access.allowedGuildId = guildId;
  mockConfig.access.dashboardAllowedUserIds = extraUsers;
  clearDashboardAccessCache();
}

beforeEach(() => {
  mockConfig.ownerId = 'owner-1';
  setLock(null);
  jest.restoreAllMocks();
});

describe('guild lock', () => {
  test('unrestricted when ALLOWED_GUILD_ID is empty', () => {
    expect(allowedGuildId()).toBeNull();
    expect(isGuildAllowed('any-guild')).toBe(true);
  });

  test('only the configured guild is allowed', () => {
    setLock('guild-1');
    expect(isGuildAllowed('guild-1')).toBe(true);
    expect(isGuildAllowed('guild-2')).toBe(false);
    expect(isGuildAllowed(null)).toBe(false);
  });

  test('leaves every other guild', async () => {
    setLock('guild-1');
    const leaveGuild = jest.fn().mockResolvedValue(undefined);
    const client: any = {
      user: { leaveGuild },
      guilds: new Map([
        ['guild-1', { id: 'guild-1', name: 'Home' }],
        ['guild-2', { id: 'guild-2', name: 'Intruder' }],
      ]),
    };

    await enforceGuildLock(client);

    expect(leaveGuild).toHaveBeenCalledTimes(1);
    expect(leaveGuild).toHaveBeenCalledWith('guild-2');
  });

  test('rejects a newly joined unauthorized guild', async () => {
    setLock('guild-1');
    const leaveGuild = jest.fn().mockResolvedValue(undefined);
    const client: any = { user: { leaveGuild }, guilds: new Map() };

    await expect(rejectGuildIfUnauthorized(client, { id: 'guild-2', name: 'Intruder' } as any)).resolves.toBe(
      true,
    );
    expect(leaveGuild).toHaveBeenCalledWith('guild-2');

    await expect(rejectGuildIfUnauthorized(client, { id: 'guild-1', name: 'Home' } as any)).resolves.toBe(false);
  });
});

describe('dashboard access', () => {
  test('owner and allowlisted users pass without a guild lock', async () => {
    expect(isDashboardUserAllowlisted('owner-1')).toBe(true);
    expect(isDashboardUserAllowlisted('random')).toBe(false);
    await expect(canAccessDashboard('random')).resolves.toBe(true);
  });

  test('extra allowlisted users pass with a guild lock', async () => {
    setLock('guild-1', ['trusted-1']);
    await expect(canAccessDashboard('trusted-1')).resolves.toBe(true);
    await expect(canAccessDashboard('owner-1')).resolves.toBe(true);
  });

  test('guild managers pass and regular members do not', async () => {
    setLock('guild-1');
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'guild-1', permissions: '32' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'guild-1', permissions: '1' }],
      });
    (global as any).fetch = fetchMock;

    await expect(canAccessDashboard('manager-1', 'token-1')).resolves.toBe(true);
    await expect(canAccessDashboard('member-1', 'token-2')).resolves.toBe(false);
  });

  test('users outside the guild are denied', async () => {
    setLock('guild-1');
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'guild-2', permissions: '8' }],
    });

    await expect(canAccessDashboard('outsider', 'token')).resolves.toBe(false);
  });

  test('denies when the Fluxer lookup fails', async () => {
    setLock('guild-1');
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => [] });

    await expect(canAccessDashboard('someone', 'token')).resolves.toBe(false);
  });
});
