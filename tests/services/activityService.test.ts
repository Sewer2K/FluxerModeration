const mockFindOneAndUpdate = jest.fn();
const mockDeleteMany = jest.fn();
const mockFind = jest.fn();
const mockAggregate = jest.fn();

jest.mock('@/models/ActivityDaily', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    find: (...args: unknown[]) => mockFind(...args),
    aggregate: (...args: unknown[]) => mockAggregate(...args),
  },
}));

import { ActivityService } from '@/services/ActivityService';

describe('ActivityService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOneAndUpdate.mockResolvedValue({});
    mockDeleteMany.mockResolvedValue({ deletedCount: 3 });
    mockFind.mockReturnValue({
      select: () => ({
        sort: () => ({
          lean: jest.fn().mockResolvedValue([]),
        }),
      }),
    });
    mockAggregate.mockResolvedValue([]);
  });

  test('buffers message and command activity into one daily upsert', async () => {
    const service = new ActivityService();
    const at = new Date('2026-09-25T14:30:00.000Z');

    service.recordMessage('guild-1', 'user-1', 'channel-1', at);
    service.recordMessage('guild-1', 'user-2', 'channel-1', at);
    service.recordCommand('guild-1', 'user-1', at);
    await service.flush();

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { guildId: 'guild-1', date: '2026-09-25' },
      expect.objectContaining({
        $inc: expect.objectContaining({
          messages: 2,
          commands: 1,
          'channels.channel-1': 2,
          'hours.14': 2,
        }),
        $max: { activeMembers: 2 },
      }),
      { upsert: true, setDefaultsOnInsert: true },
    );
  });

  test('cleans buckets outside the retention window', async () => {
    const service = new ActivityService();

    await expect(service.cleanup()).resolves.toBe(3);

    expect(mockDeleteMany).toHaveBeenCalledWith({
      date: { $lt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    });
  });

  test('returns aggregate daily data without message content or user identifiers', async () => {
    const service = new ActivityService();
    mockFind.mockReturnValue({
      select: () => ({
        sort: () => ({
          lean: jest.fn().mockResolvedValue([
            {
              date: '2026-09-25',
              messages: 4,
              activeMembers: 2,
              updatedAt: new Date('2026-09-25T15:00:00.000Z'),
              content: 'must not be returned',
              userId: 'must not be returned',
            },
          ]),
        }),
      }),
    });

    const result = await service.getDaily('guild-1', 30);

    expect(result).toEqual({
      daily: [
        expect.objectContaining({
          date: '2026-09-25',
          messages: 4,
          activeMembers: 2,
        }),
      ],
      lastUpdated: '2026-09-25T15:00:00.000Z',
    });
    expect(result.daily[0]).not.toHaveProperty('content');
    expect(result.daily[0]).not.toHaveProperty('userId');
  });
});
