import type { BotClient } from '@/types';

const mockStartApplicationOnce = jest.fn();
const mockEnforceGuildLock = jest.fn().mockResolvedValue(undefined);

jest.mock('@/services/ApplicationBootstrap', () => ({
  startApplicationOnce: (...args: unknown[]) => mockStartApplicationOnce(...args),
}));

jest.mock('@/utils/accessControl', () => ({
  enforceGuildLock: (...args: unknown[]) => mockEnforceGuildLock(...args),
}));

import ready from '@/events/ready';

describe('ready event', () => {
  test('delegates to the guarded application bootstrap', async () => {
    const client = {} as BotClient;
    const execute = ready.execute as unknown as (client: BotClient) => Promise<void>;

    await execute(client);

    expect(mockEnforceGuildLock).toHaveBeenCalledWith(client);
    expect(mockStartApplicationOnce).toHaveBeenCalledWith(client);
  });
});
