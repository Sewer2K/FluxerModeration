'use strict';

jest.mock('@/utils/isGuildChannel', () => ({ isGuildChannel: () => true }));

import type { Client, MessageReaction } from '@fluxerjs/core';
import { resolveReactionGuildId } from '@/utils/reactionGuild';
import { reactionRoleEmojiMatches } from '@/utils/reactionRoleEmoji';

describe('resolveReactionGuildId', () => {
  test('uses guild_id on the reaction payload when present', async () => {
    const client = { channels: { get: jest.fn() } } as unknown as Client;
    const reaction = {
      guildId: '111',
      channelId: '222',
    } as MessageReaction;
    const guildId = await resolveReactionGuildId(client, reaction);
    expect(guildId).toBe('111');
    expect(client.channels.get).not.toHaveBeenCalled();
  });

  test('falls back to channel.guildId when reaction guild_id is missing', async () => {
    const client = {
      channels: {
        get: jest.fn().mockReturnValue({ guildId: '999' }),
      },
    } as unknown as Client;
    const reaction = { channelId: '222' } as MessageReaction;
    const guildId = await resolveReactionGuildId(client, reaction);
    expect(guildId).toBe('999');
  });
});

describe('reactionRoleEmojiMatches', () => {
  test('matches custom emoji stored as name:id', () => {
    expect(reactionRoleEmojiMatches('party:123', { name: 'party', id: '123' })).toBe(true);
  });

  test('matches unicode with variation selectors stripped', () => {
    expect(reactionRoleEmojiMatches('👍', { name: '👍️', id: null })).toBe(true);
  });
});
