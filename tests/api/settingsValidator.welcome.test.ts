import { validateSettingsUpdate } from '@/api/middleware/settingsValidator';
import GuildSettings from '@/models/GuildSettings';

function makeWelcome(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    type: 'none',
    channelId: '1483934492413252349',
    message: 'Welcome {user} to {server}!',
    preset: null,
    imageEnabled: true,
    showRole: false,
    trigger: 'join',
    triggerRoleId: null,
    card: {
      preset: 'default',
      bgColor1: null,
      bgColor2: null,
      bgColor3: null,
      accentColor: null,
      textColor: null,
      subtextColor: null,
      countColor: null,
      greetingText: null,
      subtitle: null,
      showMemberCount: true,
      bgImageURL: null,
    },
    embed: {
      enabled: false,
      title: null,
      description: null,
      color: null,
      footer: null,
      thumbnail: false,
    },
    dm: {
      enabled: false,
      message: null,
      imageEnabled: false,
    },
    ...overrides,
  };
}

describe('validateSettingsUpdate welcomeMessage validation', () => {
  test('accepts a full welcome card payload', () => {
    const result = validateSettingsUpdate({
      welcomeMessage: makeWelcome({
        card: {
          preset: 'midnight',
          bgColor1: '#020617',
          bgImageURL: '/uploads/1483934492413252349/bg-1.png',
        },
      }),
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('coerces empty card preset and colors to null', () => {
    const result = validateSettingsUpdate({
      welcomeMessage: makeWelcome({
        card: {
          preset: '',
          bgColor1: '',
          bgColor2: '',
          accentColor: 'bad-color',
        },
      }),
    });

    expect(result.valid).toBe(true);
    const card = (result.sanitized.welcomeMessage as Record<string, unknown>).card as Record<string, unknown>;
    expect(card.preset).toBeNull();
    expect(card.bgColor1).toBeNull();
    expect(card.bgColor2).toBeNull();
    expect(card.accentColor).toBeNull();
  });

  test('rejects non-object embed and card payloads', () => {
    const embedResult = validateSettingsUpdate({
      welcomeMessage: makeWelcome({ embed: false }),
    });
    expect(embedResult.valid).toBe(false);
    expect(embedResult.errors).toContain('welcomeMessage.embed must be an object');

    const cardResult = validateSettingsUpdate({
      welcomeMessage: makeWelcome({ card: 'nope' }),
    });
    expect(cardResult.valid).toBe(false);
    expect(cardResult.errors).toContain('welcomeMessage.card must be an object');
  });

  test('migrates legacy dm fields into dm object', () => {
    const result = validateSettingsUpdate({
      welcomeMessage: makeWelcome({
        dm: undefined,
        dmEnabled: true,
        dmMessage: 'hey',
      }),
    });

    expect(result.valid).toBe(true);
    const wm = result.sanitized.welcomeMessage as Record<string, unknown>;
    expect(wm.dmEnabled).toBeUndefined();
    expect(wm.dmMessage).toBeUndefined();
    expect(wm.dm).toEqual({
      enabled: true,
      message: 'hey',
    });
  });

  test('sanitized welcome card settings pass GuildSettings schema validation', () => {
    const result = validateSettingsUpdate({
      welcomeMessage: makeWelcome({
        card: {
          preset: '',
          greetingText: '',
          bgImageURL: 'data:image/png;base64,abc',
        },
      }),
    });

    expect(result.valid).toBe(true);

    const doc = new GuildSettings({
      guildId: '9999999999999999998',
      ...result.sanitized,
    });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
    expect(doc.welcomeMessage?.card?.preset).toBeNull();
    expect(doc.welcomeMessage?.card?.greetingText).toBeNull();
    expect(doc.welcomeMessage?.card?.bgImageURL).toBeNull();
  });
});
