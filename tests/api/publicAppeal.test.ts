import express from 'express';
import request from 'supertest';
import config from '@/config';
import { createPublicRouter } from '@/api/routes/public';
import { signAppealToken } from '@/utils/appealToken';

const payload = { guildId: '123456789012345678', userId: '223456789012345678', exp: 2_000_000_000 };

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/public',
    createPublicRouter({
      client: { guilds: { get: jest.fn(), fetch: jest.fn() } },
    } as never),
  );
  return app;
}

describe('public ban appeal submission', () => {
  beforeAll(() => {
    config.api.appealSigningSecret = 'test-secret';
  });

  test('rejects a bad token', async () => {
    const response = await request(createApp()).post('/api/public/appeal/not-a-token').send({});
    expect(response.status).toBe(404);
  });

  test('rejects an expired token', async () => {
    const token = signAppealToken({ ...payload, exp: 1 }, 'test-secret');
    const response = await request(createApp()).post(`/api/public/appeal/${token}`).send({});
    expect(response.status).toBe(404);
  });
});
