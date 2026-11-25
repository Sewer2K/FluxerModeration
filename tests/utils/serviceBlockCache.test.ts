jest.mock('@/models/ServiceBlock', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    isBlocked: jest.fn(),
    upsertBlock: jest.fn(),
    removeBlock: jest.fn(),
    listBlocks: jest.fn(),
  },
}));

const ServiceBlock = require('@/models/ServiceBlock').default;
import {
  isGuildBlocked,
  isUserBlocked,
  isBlocked,
  addBlock,
  removeBlock,
  shouldSendTerminationNotice,
  terminationNotice,
  _resetServiceBlockCache,
} from '@/utils/serviceBlockCache';

function mockFind(rows: any[]) {
  ServiceBlock.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(rows) });
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetServiceBlockCache();
  mockFind([]);
  ServiceBlock.upsertBlock.mockImplementation(async (d: any) => d);
  ServiceBlock.removeBlock.mockResolvedValue(true);
});

describe('serviceBlockCache lazy load', () => {
  test('loads blocks from mongo once, then serves from memory', async () => {
    mockFind([
      { targetType: 'guild', targetId: 'g1' },
      { targetType: 'user', targetId: 'u1' },
    ]);

    expect(await isGuildBlocked('g1')).toBe(true);
    expect(await isUserBlocked('u1')).toBe(true);
    expect(await isGuildBlocked('g2')).toBe(false);

    expect(ServiceBlock.find).toHaveBeenCalledTimes(1);
  });

  test('null/undefined ids are never blocked', async () => {
    expect(await isGuildBlocked(null)).toBe(false);
    expect(await isUserBlocked(undefined)).toBe(false);
  });
});

describe('addBlock / removeBlock keep the sets in sync', () => {
  test('addBlock writes to mongo and blocks immediately without another find', async () => {
    await isGuildBlocked('g1'); // triggers the one-time load
    expect(ServiceBlock.find).toHaveBeenCalledTimes(1);

    await addBlock({
      targetType: 'user',
      targetId: 'u9',
      reason: 'spam',
      evidence: null,
      addedBy: 'owner',
      linkedGuildId: null,
    });

    expect(ServiceBlock.upsertBlock).toHaveBeenCalledTimes(1);
    expect(await isUserBlocked('u9')).toBe(true);
    expect(ServiceBlock.find).toHaveBeenCalledTimes(1);
  });

  test('a cascading guild termination blocks both the guild and its owner', async () => {
    await addBlock({
      targetType: 'guild',
      targetId: 'gowner',
      reason: 'tos',
      evidence: null,
      addedBy: 'owner',
      linkedGuildId: null,
    });
    await addBlock({
      targetType: 'user',
      targetId: 'uowner',
      reason: 'owner of gowner',
      evidence: null,
      addedBy: 'owner',
      linkedGuildId: 'gowner',
    });

    expect(await isBlocked({ guildId: 'gowner', userId: 'someone-else' })).toBe(true);
    expect(await isUserBlocked('uowner')).toBe(true);
  });

  test('removeBlock unblocks', async () => {
    await addBlock({
      targetType: 'guild',
      targetId: 'gx',
      reason: 'x',
      evidence: null,
      addedBy: 'owner',
      linkedGuildId: null,
    });
    expect(await isGuildBlocked('gx')).toBe(true);

    await removeBlock('guild', 'gx');
    expect(await isGuildBlocked('gx')).toBe(false);
  });
});

describe('shouldSendTerminationNotice rate limit', () => {
  test('first call sends, second within the window does not', () => {
    expect(shouldSendTerminationNotice('g1', 'u1')).toBe(true);
    expect(shouldSendTerminationNotice('g1', 'u1')).toBe(false);
  });

  test('different user in the same guild is tracked separately', () => {
    expect(shouldSendTerminationNotice('g1', 'u1')).toBe(true);
    expect(shouldSendTerminationNotice('g1', 'u2')).toBe(true);
  });
});

describe('terminationNotice text', () => {
  test('guild variant names the server and the appeal contact', () => {
    const msg = terminationNotice('guild');
    expect(msg).toContain('This server has been terminated');
    expect(msg).toContain('appeal');
  });

  test('user variant talks about the account', () => {
    expect(terminationNotice('user')).toContain('Your access to');
  });
});
