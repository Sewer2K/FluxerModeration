import express, { type RequestHandler } from 'express';
import request from 'supertest';

const mockGetDaily = jest.fn();
const mockGetSummary = jest.fn();
const mockGetTopChannels = jest.fn();
const mockGetHeatmap = jest.fn();
const mockGetChannels = jest.fn();

jest.mock('@/services/ActivityService', () => ({
  __esModule: true,
  default: {
    getDaily: (...args: unknown[]) => mockGetDaily(...args),
    getSummary: (...args: unknown[]) => mockGetSummary(...args),
    getTopChannels: (...args: unknown[]) => mockGetTopChannels(...args),
    getHeatmap: (...args: unknown[]) => mockGetHeatmap(...args),
  },
}));

import { createAnalyticsRouter } from '@/api/routes/analytics';

function createApp(requireGuildAccess: RequestHandler): express.Express {
  const app = express();
  const client = {
    guilds: new Map([
      [
        'guild-1',
        {
          channels: new Map(),
        },
      ],
    ]),
    rest: {
      get: mockGetChannels,
    },
  };
  const runtime = { client } as never;
  app.use('/api/guilds', createAnalyticsRouter(runtime, requireGuildAccess));
  return app;
}

describe('server activity analytics routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDaily.mockResolvedValue({
      daily: [{ date: '2026-09-25', messages: 2, activeMembers: 1 }],
      lastUpdated: '2026-09-25T12:00:00.000Z',
    });
    mockGetSummary.mockResolvedValue({ messages: 2, activeMembers: 1, lastUpdated: null });
    mockGetTopChannels.mockResolvedValue([{ channelId: 'channel-1', count: 2 }]);
    mockGetHeatmap.mockResolvedValue({ cells: [], lastUpdated: null });
    mockGetChannels.mockResolvedValue([{ id: 'channel-1', name: 'general' }]);
  });

  test('uses the existing guild authorization middleware and returns aggregate activity', async () => {
    const allow: RequestHandler = (_req, _res, next) => next();
    const response = await request(createApp(allow)).get('/api/guilds/guild-1/analytics/activity/daily?days=180');

    expect(response.status).toBe(200);
    expect(response.body.daily[0]).toEqual(expect.objectContaining({ messages: 2 }));
    expect(response.body.daily[0]).not.toHaveProperty('content');
    expect(response.body.daily[0]).not.toHaveProperty('userId');
    expect(mockGetDaily).toHaveBeenCalledWith('guild-1', 180);
  });

  test('does not expose activity when guild authorization denies access', async () => {
    const deny: RequestHandler = (_req, res) => {
      res.status(403).json({ error: 'denied' });
    };
    const response = await request(createApp(deny)).get('/api/guilds/guild-1/analytics/activity/summary');

    expect(response.status).toBe(403);
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  test('adds channel names to channel totals', async () => {
    const allow: RequestHandler = (_req, _res, next) => next();
    const response = await request(createApp(allow)).get('/api/guilds/guild-1/analytics/activity/channels?limit=5');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ channelId: 'channel-1', channelName: 'general', count: 2 }]);
    expect(mockGetTopChannels).toHaveBeenCalledWith('guild-1', 30, 5);
    expect(mockGetChannels).toHaveBeenCalledTimes(1);
  });
});
