const OWNER_ID = '111111111111111111';
const GUILD_ID = '222222222222222222';
const GUILD_OWNER_ID = '333333333333333333';
const TARGET_USER_ID = '444444444444444444';

jest.mock('@/config', () => ({
  __esModule: true,
  default: {
    ownerId: OWNER_ID,
    branding: { publicName: 'ClaudeCityMod' },
    terminationAppealTag: 'moderator#0001',
  },
}));

const mockAddBlock = jest.fn();
const mockRemoveBlock = jest.fn();
const mockGetBlock = jest.fn();
const mockListBlocks = jest.fn();

jest.mock('@/utils/serviceBlockCache', () => ({
  __esModule: true,
  addBlock: (...args: any[]) => mockAddBlock(...args),
  removeBlock: (...args: any[]) => mockRemoveBlock(...args),
  getBlock: (...args: any[]) => mockGetBlock(...args),
  listBlocks: (...args: any[]) => mockListBlocks(...args),
}));

jest.mock('@/models/ServiceBlock', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));

jest.mock('@/utils/isNetworkError', () => jest.fn(() => false));

const ServiceBlock = require('@/models/ServiceBlock').default;
import terminateCommand from '@/commands/owner/terminate';
import { MessageReaction, MessageReactionPayload, User } from '@fluxerjs/core';

function makeMessage(authorId = OWNER_ID) {
  const sentMessages: any[] = [];
  const message: any = {
    author: { id: authorId },
    guildId: null,
    guild: null,
    channelId: 'dm-1',
    reply: jest.fn(async (payload: any) => {
      const sent = {
        id: `reply-${sentMessages.length + 1}`,
        channelId: 'dm-1',
        payload,
        react: jest.fn().mockResolvedValue(undefined),
        edit: jest.fn().mockResolvedValue(undefined),
      };
      sentMessages.push(sent);
      return sent;
    }),
    _sentMessages: sentMessages,
  };
  return message;
}

function makeClient(guildOwnerId: string | null = GUILD_OWNER_ID) {
  const listeners = new Set<(...args: any[]) => void>();
  return {
    guilds: {
      get: jest.fn().mockReturnValue(guildOwnerId ? { ownerId: guildOwnerId } : null),
    },
    rest: { get: jest.fn().mockResolvedValue({}) },
    on: jest.fn((event: string, handler: (...args: any[]) => void) => {
      if (event === 'messageReactionAdd') listeners.add(handler);
    }),
    off: jest.fn((event: string, handler: (...args: any[]) => void) => {
      if (event === 'messageReactionAdd') listeners.delete(handler);
    }),
    emitReaction(payload: MessageReactionPayload) {
      for (const listener of [...listeners]) listener(payload);
    },
  } as any;
}

async function flushPromises() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function confirmLatest(message: any, client: any) {
  const confirmationMessage = message._sentMessages[message._sentMessages.length - 1];
  const reaction = {
    messageId: confirmationMessage.id,
    channelId: confirmationMessage.channelId,
    emoji: { name: '✅' },
  } as MessageReaction;
  client.emitReaction({
    ...reaction,
    reaction,
    message: null,
    channel: null,
    member: null,
    userId: OWNER_ID,
    user: { id: OWNER_ID, bot: false } as User,
  } as MessageReactionPayload);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddBlock.mockResolvedValue({});
  mockRemoveBlock.mockResolvedValue(true);
  ServiceBlock.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
});

describe('owner terminate command', () => {
  test('rejects non-owner usage', async () => {
    const message = makeMessage('999999999999999999');
    const client = makeClient();

    await terminateCommand.execute(message, ['guild', GUILD_ID, 'tos'], client, '!');

    expect(message.reply).toHaveBeenCalledWith('This command is restricted to the bot owner.');
    expect(mockAddBlock).not.toHaveBeenCalled();
  });

  test('guild termination blocks the guild and cascades to the owner', async () => {
    const message = makeMessage();
    const client = makeClient();

    const pending = terminateCommand.execute(message, ['guild', GUILD_ID, 'raiding', 'servers'], client, '!');
    await flushPromises();
    confirmLatest(message, client);
    await pending;

    expect(mockAddBlock).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'guild', targetId: GUILD_ID, reason: 'raiding servers' }),
    );
    expect(mockAddBlock).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'user', targetId: GUILD_OWNER_ID, linkedGuildId: GUILD_ID }),
    );
  });

  test('guild termination without a resolvable owner blocks only the guild', async () => {
    const message = makeMessage();
    const client = makeClient(null);

    const pending = terminateCommand.execute(message, ['guild', GUILD_ID, 'tos'], client, '!');
    await flushPromises();
    confirmLatest(message, client);
    await pending;

    expect(mockAddBlock).toHaveBeenCalledTimes(1);
    expect(mockAddBlock).toHaveBeenCalledWith(expect.objectContaining({ targetType: 'guild', targetId: GUILD_ID }));
  });

  test('cancelling on x reaction blocks nothing', async () => {
    const message = makeMessage();
    const client = makeClient();

    const pending = terminateCommand.execute(message, ['user', TARGET_USER_ID, 'tos'], client, '!');
    await flushPromises();

    const confirmationMessage = message._sentMessages[message._sentMessages.length - 1];
    const reaction = {
      messageId: confirmationMessage.id,
      channelId: confirmationMessage.channelId,
      emoji: { name: '❌' },
    } as MessageReaction;
    client.emitReaction({
      ...reaction,
      reaction,
      message: null,
      channel: null,
      member: null,
      userId: OWNER_ID,
      user: { id: OWNER_ID, bot: false } as User,
    } as MessageReactionPayload);
    await pending;

    expect(mockAddBlock).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledWith('Cancelled. Nothing was terminated.');
  });

  test('unguild removes the guild block and any cascaded owner blocks', async () => {
    ServiceBlock.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ targetType: 'user', targetId: GUILD_OWNER_ID, linkedGuildId: GUILD_ID }]),
    });
    const message = makeMessage();
    const client = makeClient();

    await terminateCommand.execute(message, ['unguild', GUILD_ID], client, '!');

    expect(mockRemoveBlock).toHaveBeenCalledWith('guild', GUILD_ID);
    expect(mockRemoveBlock).toHaveBeenCalledWith('user', GUILD_OWNER_ID);
  });
});
