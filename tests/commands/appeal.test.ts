const mockAppeal = {
  _id: 'appeal-id',
  state: 'pending',
  eligible: true,
  userId: '223456789012345678',
  guildId: '123456789012345678',
  caseNumber: 12,
  banReason: 'test reason',
  submittedAt: new Date(),
  nextEligibleAt: null,
  staffReason: '',
  answers: {
    whatHappened: 'context',
    whyLift: 'reason',
    whatDifferent: 'change',
    evidence: '',
    onlyFluxerAccount: null,
  },
};

const mockBanAppeal = {
  findLatest: jest.fn().mockResolvedValue(mockAppeal),
  find: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
};
const mockModerationLog = { logAction: jest.fn().mockResolvedValue(undefined) };
const mockTempBan = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) };
const mockSettings = {
  get: jest.fn().mockResolvedValue(null),
  getOrCreate: jest.fn().mockResolvedValue({
    language: 'en',
    appeals: { enabled: true, cooldownDays: 7, allowTempBans: false, defaultNoAppeal: false },
  }),
  invalidate: jest.fn(),
};

jest.mock('@/models/BanAppeal', () => ({ __esModule: true, default: mockBanAppeal }));
jest.mock('@/models/ModerationLog', () => ({ __esModule: true, default: mockModerationLog }));
jest.mock('@/models/TempBan', () => ({ __esModule: true, default: mockTempBan }));
jest.mock('@/models/GuildSettings', () => ({ __esModule: true, default: { updateSetting: jest.fn() } }));
jest.mock('@/utils/settingsCache', () => ({ __esModule: true, default: mockSettings }));
jest.mock('@/utils/sendUserDm', () => ({ sendUserDm: jest.fn().mockResolvedValue(true) }));

import command from '@/commands/moderation/appeal';

describe('!appeal approve', () => {
  test('unbans the user before saving approval', async () => {
    const guild = {
      id: '123456789012345678',
      name: 'Test Server',
      unban: jest.fn().mockResolvedValue(undefined),
    };
    const message = {
      guild,
      author: { id: '323456789012345678', username: 'moderator' },
      reply: jest.fn().mockResolvedValue(undefined),
    };
    const client = { users: { fetch: jest.fn() } };

    await command.execute(message as never, ['approve', mockAppeal.userId, 'reviewed'], client as never, '!');

    expect(guild.unban).toHaveBeenCalledWith(mockAppeal.userId);
    expect(mockTempBan.deleteMany).toHaveBeenCalledWith({ guildId: guild.id, userId: mockAppeal.userId });
    expect(mockBanAppeal.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'pending' }),
      expect.objectContaining({ $set: expect.objectContaining({ state: 'approved' }) }),
    );
  });
});
