import GuildSettings from '@/models/GuildSettings';
import { validateSettingsUpdate } from '@/api/middleware/settingsValidator';

const CHANNEL_ID = '1477669374509662453';
const ROLE_ID = '1477669374509662454';

function makeEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channelId: CHANNEL_ID,
    action: 'ban',
    enabled: true,
    banDeleteDays: 1,
    timeoutHours: 24,
    roleId: null,
    ...overrides,
  };
}

describe('validateSettingsUpdate honeypot validation', () => {
  test('accepts dashboard honeypot entries and passes the model schema', () => {
    const result = validateSettingsUpdate({
      honeypotChannels: [
        makeEntry(),
        makeEntry({
          channelId: '1477669374509662455',
          action: 'timeout',
          timeoutHours: 48,
        }),
        makeEntry({
          channelId: '1477669374509662456',
          action: 'role',
          roleId: ROLE_ID,
        }),
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    const doc = new GuildSettings({
      guildId: '1477669374509662457',
      ...result.sanitized,
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  test('rejects honeypot channel ID strings instead of entries', () => {
    const result = validateSettingsUpdate({
      honeypotChannels: [CHANNEL_ID],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Each honeypot channel must be an object');
  });

  test('rejects invalid honeypot entry fields', () => {
    const cases = [
      ['channel ID', { channelId: 'not-a-channel' }, 'honeypotChannels[].channelId must be a valid channel ID'],
      ['action', { action: 'warn' }, 'honeypotChannels[].action must be ban, kick, timeout, or role'],
      ['enabled flag', { enabled: 'yes' }, 'honeypotChannels[].enabled must be boolean'],
      ['ban delete days', { banDeleteDays: 8 }, 'honeypotChannels[].banDeleteDays must be between 0 and 7'],
      ['timeout hours', { timeoutHours: 0 }, 'honeypotChannels[].timeoutHours must be between 1 and 672'],
      ['role ID', { roleId: 'not-a-role' }, 'honeypotChannels[].roleId must be a valid role ID'],
    ] as const;

    for (const [, overrides, error] of cases) {
      const result = validateSettingsUpdate({
        honeypotChannels: [makeEntry(overrides)],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(error);
    }
  });

  test('rejects more than twenty honeypot entries', () => {
    const result = validateSettingsUpdate({
      honeypotChannels: Array.from({ length: 21 }, (_, index) =>
        makeEntry({ channelId: `1477669374509662${String(index).padStart(3, '0')}` }),
      ),
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Maximum 20 honeypot channels allowed');
  });
});
