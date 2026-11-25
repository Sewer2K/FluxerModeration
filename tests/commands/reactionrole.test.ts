import { normalizeEmojiInput, parseRoleId } from '@/commands/admin/reactionrole';

describe('reaction role command input', () => {
  test.each([
    ['1234567890123456789', '1234567890123456789'],
    ['<1234567890123456789>', '1234567890123456789'],
    ['<@1234567890123456789>', '1234567890123456789'],
    ['<@&1234567890123456789>', '1234567890123456789'],
  ])('accepts role ID format %s', (input, expected) => {
    expect(parseRoleId(input)).toBe(expected);
  });

  test('rejects non-role input', () => {
    expect(parseRoleId('not-a-role')).toBeNull();
  });

  test('unwraps angle brackets around Unicode emoji', () => {
    expect(normalizeEmojiInput('<💙>')).toBe('💙');
  });

  test('keeps custom emoji syntax intact', () => {
    expect(normalizeEmojiInput('<:blue_heart:1234567890123456789>')).toBe('<:blue_heart:1234567890123456789>');
  });
});
