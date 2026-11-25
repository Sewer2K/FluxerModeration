jest.mock('@/config', () => ({
  __esModule: true,
  default: {
    api: { adminToken: 'internal-secret' },
    bot: { internalUrl: 'http://127.0.0.1:4001' },
  },
}));

import { sendBugReportReply } from '@/api/notifyBotBugReport';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sendBugReportReply', () => {
  test('returns success when the bot confirms delivery', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await expect(sendBugReportReply('300000000000000001', '65f000000000000000000001', 'Fixed it.')).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4001/internal/bug-report-reply',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer internal-secret' }),
        body: JSON.stringify({
          userId: '300000000000000001',
          reportId: '65f000000000000000000001',
          message: 'Fixed it.',
        }),
      }),
    );
  });

  test('returns the bot failure without claiming delivery', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Fluxer did not accept the direct message' }),
    });

    await expect(sendBugReportReply('300000000000000001', '65f000000000000000000001', 'Fixed it.')).resolves.toEqual({
      ok: false,
      error: 'Fluxer did not accept the direct message',
    });
  });

  test('returns a connection error when the bot cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));

    await expect(sendBugReportReply('300000000000000001', '65f000000000000000000001', 'Fixed it.')).resolves.toEqual({
      ok: false,
      error: 'The bot process could not be reached',
    });
  });
});
