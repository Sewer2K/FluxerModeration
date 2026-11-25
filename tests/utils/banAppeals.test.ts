jest.mock('@/config', () => ({
  __esModule: true,
  default: {
    api: { dashboardUrl: 'https://bot.example.com', appealSigningSecret: 'test-secret' },
  },
}));

const mockFindLatest = jest.fn().mockResolvedValue(null);
const mockFindOneAndUpdate = jest.fn().mockResolvedValue({});
jest.mock('@/models/BanAppeal', () => ({
  __esModule: true,
  default: { findLatest: mockFindLatest, findOneAndUpdate: mockFindOneAndUpdate },
}));

const mockGetSettings = jest.fn();
jest.mock('@/utils/settingsCache', () => ({
  __esModule: true,
  default: { get: mockGetSettings },
}));

const mockSendUserDm = jest.fn().mockResolvedValue(false);
jest.mock('@/utils/sendUserDm', () => ({ sendUserDm: mockSendUserDm }));

import { nextAppealEligibleAt, recordBanAppeal } from '@/utils/banAppeals';

describe('ban appeal policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockResolvedValue({
      appeals: { enabled: true, cooldownDays: 7, allowTempBans: false, defaultNoAppeal: false },
    });
  });

  test('does not DM a noappeal ban', async () => {
    await recordBanAppeal({} as never, {
      guildId: '123456789012345678',
      userId: '223456789012345678',
      source: 'command',
      banReason: 'staff decision',
      moderatorId: '323456789012345678',
      permanent: true,
      eligible: false,
    });

    expect(mockFindOneAndUpdate).toHaveBeenCalled();
    expect(mockSendUserDm).not.toHaveBeenCalled();
  });

  test('uses the configured denial cooldown and a one-day dismissal wait', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(nextAppealEligibleAt('deny', 7, now).toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(nextAppealEligibleAt('dismiss', 7, now).toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });
});
