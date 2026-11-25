import { DEFAULT_MESSAGE_XP_QUALITY } from '@/types/Leveling';
import {
  evaluateMessageXpQuality,
  normalizeMessageFingerprint,
  resetMessageXpQualityStateForTests,
} from '@/utils/leveling/messageXpQuality';

const quality = { ...DEFAULT_MESSAGE_XP_QUALITY };

function evaluate(
  content: string,
  overrides: Partial<Parameters<typeof evaluateMessageXpQuality>[1]> = {},
  qualityOverrides: Partial<typeof quality> = {},
) {
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  return evaluateMessageXpQuality(
    { ...quality, ...qualityOverrides },
    {
      guildId: 'g1',
      userId: 'u1',
      content,
      wordCount,
      isCommand: false,
      hasAttachments: false,
      hasStickers: false,
      ...overrides,
    },
  );
}

describe('messageXpQuality', () => {
  beforeEach(() => {
    resetMessageXpQualityStateForTests();
  });

  test('normalizes fingerprints for duplicate detection', () => {
    expect(normalizeMessageFingerprint('  Hello!! World  ')).toBe('hello world');
  });

  test('allows a normal message', () => {
    expect(evaluate('hello everyone here').allowed).toBe(true);
  });

  test('blocks short and low-effort messages without consuming cooldown path', () => {
    expect(evaluate('a').reason).toBe('too_short');
    expect(evaluate('ok cool').reason).toBe('too_short');
    expect(evaluate('aaaaaa bbbbbb').reason).toBe('low_unique_chars');
  });

  test('blocks commands emoji-only and attachment-only messages', () => {
    expect(evaluate('!rank card please', { isCommand: true }).reason).toBe('command');
    expect(evaluate('🔥🔥🔥').reason).toBe('emoji_only');
    expect(evaluate('', { hasAttachments: true }).reason).toBe('attachment_only');
  });

  test('allows attachment-only messages when the explicit ignore toggle is off', () => {
    expect(evaluate('', { hasAttachments: true }, { ignoreOnlyAttachments: false }).allowed).toBe(true);
  });

  test('blocks repeated messages after the configured duplicate limit', () => {
    const msg = 'same message twice is fine';
    expect(evaluate(msg).allowed).toBe(true);
    expect(evaluate(msg).allowed).toBe(true);
    expect(evaluate(msg).reason).toBe('duplicate');
  });

  test('blocks burst spam inside the burst window', () => {
    expect(evaluate('first valid message here').allowed).toBe(true);
    expect(evaluate('second valid message here').allowed).toBe(true);
    expect(evaluate('third valid message here').allowed).toBe(true);
    expect(evaluate('fourth valid message here').allowed).toBe(true);
    expect(evaluate('fifth valid message here').reason).toBe('burst');
  });

  test('can be disabled per guild', () => {
    expect(
      evaluateMessageXpQuality(
        { ...quality, enabled: false },
        {
          guildId: 'g1',
          userId: 'u1',
          content: 'a',
          wordCount: 1,
          isCommand: false,
          hasAttachments: false,
          hasStickers: false,
        },
      ).allowed,
    ).toBe(true);
  });
});
