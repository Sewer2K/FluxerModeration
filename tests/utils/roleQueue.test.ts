export {};

jest.mock('fs');

const mockIsNetworkError = jest.fn().mockReturnValue(false);
jest.mock('@/utils/isNetworkError', () => ({ __esModule: true, default: mockIsNetworkError }));

const fs = require('fs');

fs.existsSync.mockReturnValue(false);
fs.mkdirSync.mockReturnValue(undefined);
fs.writeFileSync.mockReturnValue(undefined);

let roleQueue: any;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  mockIsNetworkError.mockReturnValue(false);
  jest.doMock('fs');
  jest.doMock('@/utils/isNetworkError', () => ({ __esModule: true, default: mockIsNetworkError }));
  const freshFs = require('fs');
  freshFs.existsSync.mockReturnValue(false);
  freshFs.mkdirSync.mockReturnValue(undefined);
  freshFs.writeFileSync.mockReturnValue(undefined);
  roleQueue = require('@/utils/roleQueue');
});

describe('enqueue', () => {
  test('adds an entry and persists to disk', () => {
    const freshFs = require('fs');
    roleQueue.enqueue('g1', 'u1', 'r1', 'add');
    expect(freshFs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  test('does not add duplicate entries (same guild + user + role + operation)', () => {
    const freshFs = require('fs');
    roleQueue.enqueue('g1', 'u1', 'r1', 'add');
    roleQueue.enqueue('g1', 'u1', 'r1', 'add');
    expect(freshFs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  test('allows same role with different operation (add vs remove)', () => {
    const freshFs = require('fs');
    roleQueue.enqueue('g1', 'u1', 'r1', 'add');
    roleQueue.enqueue('g1', 'u1', 'r1', 'remove');
    expect(freshFs.writeFileSync).toHaveBeenCalledTimes(2);
  });

  test('adds separate entries for different users', () => {
    const freshFs = require('fs');
    roleQueue.enqueue('g1', 'u1', 'r1', 'add');
    roleQueue.enqueue('g1', 'u2', 'r1', 'add');
    expect(freshFs.writeFileSync).toHaveBeenCalledTimes(2);
  });

  test('adds separate entries for different roles', () => {
    const freshFs = require('fs');
    roleQueue.enqueue('g1', 'u1', 'r1', 'add');
    roleQueue.enqueue('g1', 'u1', 'r2', 'add');
    expect(freshFs.writeFileSync).toHaveBeenCalledTimes(2);
  });

  test('defaults to add operation', () => {
    const freshFs = require('fs');
    roleQueue.enqueue('g1', 'u1', 'r1');
    const written = JSON.parse(freshFs.writeFileSync.mock.calls[0][1]);
    expect(written[0].operation).toBe('add');
  });

  test('drops oldest entry when queue is full (500)', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 500; i++) {
      roleQueue.enqueue('g1', `u${i}`, 'r1', 'add');
    }
    roleQueue.enqueue('g1', 'u999', 'r1', 'add');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Queue full'));
    warnSpy.mockRestore();
  });
});

describe('start + processQueue', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('loads queue from disk on start and logs count', () => {
    const freshFs = require('fs');
    freshFs.existsSync.mockReturnValue(true);
    freshFs.readFileSync.mockReturnValue(
      JSON.stringify([{ guildId: 'g1', userId: 'u1', roleId: 'r1', operation: 'add', addedAt: Date.now() }]),
    );

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const mockMember = {
      roles: {
        add: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      },
    };
    const mockGuild = {
      name: 'Test',
      members: { get: jest.fn().mockReturnValue(mockMember) },
      fetchMember: jest.fn().mockResolvedValue(mockMember),
    };
    const mockClient = { guilds: { get: jest.fn().mockReturnValue(mockGuild) } };

    roleQueue.start(mockClient);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Loaded 1 pending'));
    logSpy.mockRestore();
  });

  test('processes add operations by calling member.roles.add', async () => {
    const mockMember = {
      roles: {
        add: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      },
    };
    const mockGuild = {
      name: 'Test',
      members: { get: jest.fn().mockReturnValue(mockMember) },
    };
    const mockClient = { guilds: { get: jest.fn().mockReturnValue(mockGuild) } };

    roleQueue.start(mockClient);
    roleQueue.enqueue('g1', 'u1', 'r1', 'add');

    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockMember.roles.add).toHaveBeenCalledWith('r1');
  });

  test('processes remove operations by calling member.roles.remove', async () => {
    const mockMember = {
      roles: {
        add: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      },
    };
    const mockGuild = {
      name: 'Test',
      members: { get: jest.fn().mockReturnValue(mockMember) },
    };
    const mockClient = { guilds: { get: jest.fn().mockReturnValue(mockGuild) } };

    roleQueue.start(mockClient);
    roleQueue.enqueue('g1', 'u1', 'r1', 'remove');

    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockMember.roles.remove).toHaveBeenCalledWith('r1');
  });

  test('keeps entry on network error and retries', async () => {
    jest.resetModules();
    jest.doMock('fs');
    jest.doMock('@/utils/isNetworkError', () => ({ __esModule: true, default: () => true }));
    const freshFs = require('fs');
    freshFs.existsSync.mockReturnValue(false);
    freshFs.mkdirSync.mockReturnValue(undefined);
    freshFs.writeFileSync.mockReturnValue(undefined);
    const rq = require('@/utils/roleQueue');

    const networkErr = new Error('ECONNRESET');
    const mockMember = { roles: { add: jest.fn().mockRejectedValue(networkErr) } };
    const mockGuild = {
      name: 'Test',
      members: { get: jest.fn().mockReturnValue(mockMember) },
    };
    const mockClient = { guilds: { get: jest.fn().mockReturnValue(mockGuild) } };

    rq.start(mockClient);
    rq.enqueue('g1', 'u1', 'r1', 'add');

    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockMember.roles.add).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockMember.roles.add).toHaveBeenCalledTimes(2);
  });

  test('drops entry on permanent (non-network) error', async () => {
    jest.resetModules();
    jest.doMock('fs');
    jest.doMock('@/utils/isNetworkError', () => ({ __esModule: true, default: () => false }));
    const freshFs = require('fs');
    freshFs.existsSync.mockReturnValue(false);
    freshFs.mkdirSync.mockReturnValue(undefined);
    freshFs.writeFileSync.mockReturnValue(undefined);
    const rq = require('@/utils/roleQueue');

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const permErr = new Error('Missing Permissions');
    const mockMember = { roles: { add: jest.fn().mockRejectedValue(permErr) } };
    const mockGuild = {
      name: 'Test',
      members: { get: jest.fn().mockReturnValue(mockMember) },
    };
    const mockClient = { guilds: { get: jest.fn().mockReturnValue(mockGuild) } };

    rq.start(mockClient);
    rq.enqueue('g1', 'u1', 'r1', 'add');

    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockMember.roles.add).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Permanent error'));

    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockMember.roles.add).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  test('drops stale entries older than 24h', async () => {
    jest.resetModules();
    jest.mock('fs');
    const fs2 = require('fs');
    fs2.existsSync.mockReturnValue(true);
    fs2.readFileSync.mockReturnValue(
      JSON.stringify([
        { guildId: 'g1', userId: 'u1', roleId: 'r1', operation: 'add', addedAt: Date.now() - 25 * 60 * 60 * 1000 },
      ]),
    );
    fs2.mkdirSync.mockReturnValue(undefined);
    fs2.writeFileSync.mockReturnValue(undefined);
    const rq = require('@/utils/roleQueue');

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const mockClient = { guilds: { get: jest.fn().mockReturnValue(null) } };

    rq.start(mockClient);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dropping stale'));
    logSpy.mockRestore();
  });
});
