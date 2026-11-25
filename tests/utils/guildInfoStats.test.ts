import { formatGuildFeatures, normalizeGuildFeatures } from '@/utils/guildInfoStats';
import { snowflakeToDate } from '@/utils/snowflakeDate';

describe('snowflakeDate', () => {
  test('parses large Fluxer snowflakes without precision loss', () => {
    const date = snowflakeToDate('1474064035832316065');
    expect(date).toBeInstanceOf(Date);
    expect(Number.isNaN(date!.getTime())).toBe(false);
    expect(date!.toISOString()).toBe('2026-02-19T15:24:12.927Z');
  });
});

describe('guildInfoStats', () => {
  test('normalizes comma-separated feature strings', () => {
    expect(normalizeGuildFeatures('ANIMATED_BANNER, ANIMATED_ICON, BANNER')).toEqual([
      'ANIMATED_BANNER',
      'ANIMATED_ICON',
      'BANNER',
    ]);
  });

  test('formats guild features using Fluxer docs labels', () => {
    expect(formatGuildFeatures(['VANITY_URL', 'MORE_EMOJI'], 'None')).toBe('Vanity URL, Increased emoji slots');
    expect(formatGuildFeatures('ANIMATED_BANNER, VANITY_URL', 'None')).toBe('Animated banner, Vanity URL');
    expect(formatGuildFeatures([], 'None')).toBe('None');
  });
});
