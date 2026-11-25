jest.mock('../../dashboard/src/lib/glitchtip', () => ({
  GlitchTip: {
    captureException: jest.fn(),
  },
}));

const { normalizeSettings, normalizeWelcomeMessage } = require('../../dashboard/src/lib/api');

describe('normalizeSettings welcomeMessage', () => {
  test('preserves triggerRoleId for role-triggered welcomes', () => {
    const result = normalizeSettings({
      guildId: 'g1',
      welcomeMessage: {
        enabled: true,
        trigger: 'role',
        triggerRoleId: 'verified-role',
      } as any,
    });

    expect(result.welcomeMessage.trigger).toBe('role');
    expect(result.welcomeMessage.triggerRoleId).toBe('verified-role');
  });

  test('coerces empty card preset and legacy embed booleans', () => {
    const result = normalizeWelcomeMessage({
      imageEnabled: true,
      card: {
        preset: '',
        bgColor1: '',
        bgImageURL: 'data:image/png;base64,abc',
      },
      embed: false,
      dm: false,
    });

    expect(result.card.preset).toBeNull();
    expect(result.card.bgColor1).toBeNull();
    expect(result.card.bgImageURL).toBeNull();
    expect(result.embed.enabled).toBe(false);
    expect(result.dm.enabled).toBe(false);
  });
});
