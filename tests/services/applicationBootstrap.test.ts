import type { Client } from '@fluxerjs/core';
import { GatewayStartupGate } from '@/gateway/GatewayStartupGate';

const mockAutoroleStart = jest.fn();
const mockEmbedStart = jest.fn();
const mockRoleStart = jest.fn();
const mockModerationStart = jest.fn();
const mockMessageDeleteStart = jest.fn();
const mockRssStart = jest.fn();
const mockSocialStart = jest.fn();
const mockLevelHighlightStart = jest.fn();
const mockSettingsSet = jest.fn();
const mockGuildSettingsFind = jest.fn();
const mockLogBox = jest.fn();
const mockLogOk = jest.fn();
const mockLogWarn = jest.fn();
const mockRecordGuildSnapshot = jest.fn().mockResolvedValue(undefined);
const mockRecordGuildMemberSnapshot = jest.fn().mockResolvedValue(undefined);
const mockActivityStart = jest.fn();

jest.mock('@/utils/autoroleQueue', () => ({
  start: (...args: unknown[]) => mockAutoroleStart(...args),
}));
jest.mock('@/utils/embedQueue', () => ({
  start: (...args: unknown[]) => mockEmbedStart(...args),
}));
jest.mock('@/utils/roleQueue', () => ({
  start: (...args: unknown[]) => mockRoleStart(...args),
}));
jest.mock('@/utils/moderationQueue', () => ({
  start: (...args: unknown[]) => mockModerationStart(...args),
}));
jest.mock('@/utils/messageDeleteQueue', () => ({
  start: (...args: unknown[]) => mockMessageDeleteStart(...args),
}));
jest.mock('@/services/RssPollerService', () => ({
  __esModule: true,
  default: { start: (...args: unknown[]) => mockRssStart(...args) },
}));
jest.mock('@/services/SocialPollerService', () => ({
  __esModule: true,
  default: { start: (...args: unknown[]) => mockSocialStart(...args) },
}));
jest.mock('@/services/LevelHighlightService', () => ({
  startLevelHighlightService: (...args: unknown[]) => mockLevelHighlightStart(...args),
}));
jest.mock('@/utils/settingsCache', () => ({
  __esModule: true,
  default: {
    getStats: () => ({ validEntries: 0 }),
    set: (...args: unknown[]) => mockSettingsSet(...args),
  },
}));
jest.mock('@/models/GuildSettings', () => ({
  __esModule: true,
  default: {
    find: (...args: unknown[]) => mockGuildSettingsFind(...args),
  },
}));
jest.mock('@/utils/consoleLogger', () => ({
  __esModule: true,
  default: {
    box: (...args: unknown[]) => mockLogBox(...args),
    ok: (...args: unknown[]) => mockLogOk(...args),
    warn: (...args: unknown[]) => mockLogWarn(...args),
  },
}));
jest.mock('@/config', () => ({
  __esModule: true,
  default: { branding: { publicName: 'ClaudeCityMod' } },
}));
jest.mock('@/services/StatsService', () => ({
  __esModule: true,
  default: {
    recordGuildSnapshot: (...args: unknown[]) => mockRecordGuildSnapshot(...args),
    recordGuildMemberSnapshot: (...args: unknown[]) => mockRecordGuildMemberSnapshot(...args),
  },
}));
jest.mock('@/services/ActivityService', () => ({
  __esModule: true,
  default: {
    start: (...args: unknown[]) => mockActivityStart(...args),
  },
}));
jest.mock('@/utils/memberCounter', () => ({
  get: () => 42,
}));
jest.mock('@/utils/raidDetector', () => ({
  restoreRaidInviteLocks: jest.fn().mockResolvedValue(undefined),
}));

import { startApplicationOnce } from '@/services/ApplicationBootstrap';

describe('application bootstrap', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGuildSettingsFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ guildId: 'guild-1' }]),
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('starts every application service after Resume without waiting for Ready', async () => {
    const guild = { id: 'guild-1' };
    const client = { guilds: new Map([[guild.id, guild]]) } as unknown as Client;
    const gate = new GatewayStartupGate({
      passive: false,
      startApplication: () => {
        startApplicationOnce(client);
      },
      startPresenceUpdates: jest.fn(),
      scheduleTempBanExpiries: jest.fn(),
      scheduleGatewayInfo: jest.fn(),
    });

    expect(gate.onResume()).toBe(true);
    expect(gate.onResume()).toBe(false);
    expect(jest.getTimerCount()).toBe(2);
    expect(mockRssStart).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(25_000);

    const starts = [
      mockAutoroleStart,
      mockEmbedStart,
      mockRoleStart,
      mockModerationStart,
      mockMessageDeleteStart,
      mockRssStart,
      mockSocialStart,
      mockLevelHighlightStart,
    ];
    for (const start of starts) {
      expect(start).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledWith(client);
    }

    expect(mockGuildSettingsFind).toHaveBeenCalledTimes(1);
    expect(mockSettingsSet).toHaveBeenCalledWith('guild-1', { guildId: 'guild-1' });
    expect(gate.onReady()).toBe(false);
    expect(startApplicationOnce(client)).toBe(false);
    expect(jest.getTimerCount()).toBe(1);
  });
});
