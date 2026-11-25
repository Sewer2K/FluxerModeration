'use strict';

const mockTicket = {
  countDocuments: jest.fn(),
  getNextNumber: jest.fn(),
  create: jest.fn(),
};
const mockSettingsCache = { invalidate: jest.fn() };
const mockActivityService = { recordTicket: jest.fn() };
const mockGuildSettings = { getOrCreate: jest.fn(), find: jest.fn() };
const mockSettings = {
  language: 'en',
  ticketCategoryId: 'category123',
  ticketSupportRoleIds: [],
  ticketSupportRoleId: null,
  ticketMaxOpen: 3,
  ticketOpenMessage: null,
  markModified: jest.fn(),
  save: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@/models/Ticket', () => ({ __esModule: true, default: mockTicket }));
jest.mock('@/models/GuildSettings', () => ({
  __esModule: true,
  default: mockGuildSettings,
}));
jest.mock('@/utils/settingsCache', () => ({ __esModule: true, default: mockSettingsCache }));
jest.mock('@/services/ActivityService', () => ({ __esModule: true, default: mockActivityService }));

import { PermissionFlags, OverwriteType } from '@fluxerjs/core';
import ticketCommand, { createTicketForUser } from '@/commands/admin/ticket';
import { repairTicketCategoryPermissions } from '@/services/TicketPermissionService';

describe('ticket permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTicket.countDocuments.mockResolvedValue(0);
    mockTicket.getNextNumber.mockResolvedValue(12);
    mockTicket.create.mockResolvedValue({});
    mockActivityService.recordTicket.mockReturnValue(undefined);
    mockSettings.save.mockResolvedValue(undefined);
    mockSettings.ticketCategoryId = 'category123';
    mockSettings.ticketSupportRoleIds = [];
    mockSettings.ticketSupportRoleId = null;
    mockSettings.ticketOpenMessage = null;
    mockGuildSettings.getOrCreate.mockResolvedValue(mockSettings);
  });

  test('includes Manage Channels in the bot overwrite for created tickets', async () => {
    const channel = { id: 'ticket123', send: jest.fn().mockResolvedValue({}) };
    const createChannel = jest.fn().mockResolvedValue(channel);
    const guild = { id: 'guild123', name: 'Test Server', createChannel };
    const client = { user: { id: 'bot123' } };

    const result = await createTicketForUser(guild as any, 'user123', mockSettings as any, client as any);

    expect(result.success).toBe(true);
    const options = createChannel.mock.calls[0][0];
    const botOverwrite = options.permissionOverwrites.find((overwrite: any) => overwrite.id === 'bot123');

    expect(botOverwrite).toEqual({
      id: 'bot123',
      type: OverwriteType.Member,
      allow: String(
        PermissionFlags.ViewChannel |
          PermissionFlags.SendMessages |
          PermissionFlags.ManageMessages |
          PermissionFlags.ManageChannels |
          PermissionFlags.EmbedLinks |
          PermissionFlags.ReadMessageHistory,
      ),
      deny: '0',
    });
  });

  test('turns a permission failure into an actionable ticket setup error', async () => {
    const createChannel = jest.fn().mockRejectedValue({ statusCode: 403 });
    const guild = { id: 'guild456', name: 'Test Server', createChannel };
    const client = { user: { id: 'bot123' } };

    const result = await createTicketForUser(guild as any, 'user456', mockSettings as any, client as any);

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Manage Channels in the configured ticket category');
  });

  test('gives a newly created ticket category a bot-specific Manage Channels overwrite', async () => {
    const category = { id: 'category456' };
    const createChannel = jest.fn().mockResolvedValue(category);
    const guild = {
      id: 'guild789',
      name: 'Test Server',
      createChannel,
      members: { get: jest.fn().mockReturnValue({ permissions: { has: jest.fn().mockReturnValue(true) } }) },
    };
    const message = { guild, author: { id: 'admin123' }, reply: jest.fn().mockResolvedValue({}) };
    const client = { user: { id: 'bot123' } };

    await ticketCommand.execute(message as any, ['setup', 'category', 'create'], client as any, '!');

    expect(createChannel).toHaveBeenCalledWith({
      type: 4,
      name: 'Tickets',
      permissionOverwrites: [
        {
          id: 'bot123',
          type: OverwriteType.Member,
          allow: String(PermissionFlags.ViewChannel | PermissionFlags.ManageChannels),
          deny: '0',
        },
      ],
    });
    expect(mockSettings.ticketCategoryId).toBe('category456');
  });

  test('repairs configured ticket categories across guilds', async () => {
    const edit = jest.fn().mockResolvedValue(undefined);
    const category = {
      guildId: 'guild999',
      isCategory: jest.fn().mockReturnValue(true),
      permissionOverwrites: { cache: new Map(), edit },
    };
    const guild = {
      id: 'guild999',
      name: 'Existing Server',
      channels: { get: jest.fn().mockReturnValue(category) },
    };
    mockGuildSettings.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ guildId: 'guild999', ticketCategoryId: 'category999' }]),
      }),
    });

    await repairTicketCategoryPermissions({
      user: { id: 'bot123' },
      guilds: new Map([['guild999', guild]]),
    } as any);

    expect(edit).toHaveBeenCalledWith('bot123', {
      type: OverwriteType.Member,
      allow: String(PermissionFlags.ViewChannel | PermissionFlags.ManageChannels),
      deny: '0',
    });
  });
});
