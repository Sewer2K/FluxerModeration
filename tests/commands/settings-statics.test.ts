// Regression for CCM-7J / CCM-7K: keywords.ts and honeypot.ts aliased
// GuildSettings.getOrCreate to a bare const, detaching it from its mongoose
// statics `this` and crashing with "Cannot read properties of undefined
// (reading 'findOne')". The mock below behaves like a real mongoose static:
// getOrCreate needs `this`, so a detached call throws again.

jest.mock('@/models/GuildSettings', () => {
  const doc = {
    language: 'en',
    keywordWarnings: { enabled: false, keywords: [], action: 'delete+warn' },
    honeypotChannels: [],
    honeypotAlertRoleId: null,
    save: jest.fn().mockResolvedValue(undefined),
    markModified: jest.fn(),
  };
  const statics = {
    findOne: jest.fn().mockResolvedValue(doc),
  } as { findOne: jest.Mock; getOrCreate?: (guildId: string) => Promise<typeof doc> };
  statics.getOrCreate = function (guildId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).findOne({ guildId }).then((found: typeof doc | null) => found ?? doc);
  };
  return { __esModule: true, default: statics };
});

import keywordsCmd from '@/commands/admin/keywords';
import honeypotCmd from '@/commands/admin/honeypot';

function makeMessage() {
  const replies: unknown[] = [];
  return {
    guild: { id: 'g1', name: 'Test Server' },
    guildId: 'g1',
    author: { id: 'admin1', username: 'admin' },
    reply: jest.fn((content: unknown) => {
      replies.push(content);
      return Promise.resolve();
    }),
    replies,
  };
}

describe('settings statics keep their `this`', () => {
  test('!keywords list does not crash on getOrCreate', async () => {
    const message = makeMessage();
    await expect(keywordsCmd.execute(message as never, ['list'], {} as never, '!')).resolves.toBeUndefined();
    expect(message.reply).toHaveBeenCalledTimes(1);
  });

  test('!honeypot list does not crash on getOrCreate', async () => {
    const message = makeMessage();
    await expect(honeypotCmd.execute(message as never, ['list'], {} as never, '!')).resolves.toBeUndefined();
    expect(message.reply).toHaveBeenCalledTimes(1);
  });
});
