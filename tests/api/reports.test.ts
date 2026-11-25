jest.mock('@/models/BugReport', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    countDocuments: jest.fn(),
  },
}));

import express, { type RequestHandler } from 'express';
import request from 'supertest';
import type { BotClient } from '@/types';
import type { AuthRequest } from '@/api/middleware/auth';
import { createReportsRouter, parseBugReportLinks } from '@/api/routes/reports';

const bugReportModel = jest.requireMock('@/models/BugReport').default as {
  find: jest.Mock;
  countDocuments: jest.Mock;
};

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function createApp(owner: boolean): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const authReq = req as AuthRequest;
    authReq.userId = '300000000000000001';
    authReq.fluxerToken = 'oauth-token';
    authReq.isOwner = owner;
    next();
  });

  const requireOwner: RequestHandler = (req, res, next) => {
    if (!(req as AuthRequest).isOwner) {
      res.status(403).json({ error: 'owner only' });
      return;
    }
    next();
  };
  const client = {
    guilds: new Map(),
    fetchAllGuildIds: async () => new Set(['guild-2']),
  } as unknown as BotClient;
  app.use('/api/reports', createReportsRouter(client, requireOwner));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('parseBugReportLinks', () => {
  test('normalizes unique HTTPS links', () => {
    expect(parseBugReportLinks(' https://example.com/a \nhttps://example.com/a\nhttps://example.com/b ')).toEqual({
      links: ['https://example.com/a', 'https://example.com/b'],
    });
  });

  test('rejects non-HTTPS links', () => {
    expect(parseBugReportLinks('http://example.com/image.png')).toEqual({ error: 'Links must use HTTPS' });
  });

  test('rejects more than five links', () => {
    const links = Array.from({ length: 6 }, (_, index) => `https://example.com/${index}`).join('\n');
    expect(parseBugReportLinks(links)).toEqual({ error: 'Add no more than 5 links' });
  });
});

describe('reports router', () => {
  test('keeps report inbox owner-only', async () => {
    const res = await request(createApp(false)).get('/api/reports');
    expect(res.status).toBe(403);
    expect(bugReportModel.find).not.toHaveBeenCalled();
  });

  test('returns only servers where the user shares ClaudeCityMod with the bot', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { id: 'guild-1', name: 'No Bot Here', icon: null },
          { id: 'guild-2', name: 'Bot Server', icon: 'icon-2' },
        ]),
    });

    const res = await request(createApp(false)).get('/api/reports/context');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'guild-2', name: 'Bot Server', icon: 'icon-2' }]);
  });

  test('rejects invalid evidence before contacting Fluxer', async () => {
    const res = await request(createApp(false)).post('/api/reports').send({
      guildId: 'guild-2',
      description: 'The dashboard is showing the wrong status.',
      links: 'http://example.com/video.mp4',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Links must use HTTPS');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('lists reports for the owner with a status filter', async () => {
    const reports = [{ _id: 'report-1', status: 'open' }];
    bugReportModel.find.mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: () => Promise.resolve(reports),
        }),
      }),
    });
    bugReportModel.countDocuments.mockResolvedValue(1);

    const res = await request(createApp(true)).get('/api/reports?status=open');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reports, total: 1 });
    expect(bugReportModel.find).toHaveBeenCalledWith({ status: 'open' });
  });
});
