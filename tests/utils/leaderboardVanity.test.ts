import {
  normalizeLeaderboardVanity,
  validateLeaderboardVanityFormat,
  isSnowflakeId,
  RESERVED_LEADERBOARD_VANITIES,
} from '@/utils/leveling/leaderboardVanity';

describe('leaderboardVanity', () => {
  it('normalizes valid slugs', () => {
    expect(normalizeLeaderboardVanity('My-Server')).toBe('my-server');
    expect(normalizeLeaderboardVanity('  cool-guild  ')).toBe('cool-guild');
  });

  it('rejects invalid slugs', () => {
    expect(normalizeLeaderboardVanity('')).toBeNull();
    expect(normalizeLeaderboardVanity('-bad')).toBeNull();
    expect(normalizeLeaderboardVanity('bad-')).toBeNull();
    expect(normalizeLeaderboardVanity('a--b')).toBeNull();
    expect(normalizeLeaderboardVanity('!!!')).toBeNull();
    expect(normalizeLeaderboardVanity('x'.repeat(33))).toBeNull();
  });

  it('rejects reserved slugs and snowflakes', () => {
    expect(normalizeLeaderboardVanity('lb')).toBeNull();
    expect(normalizeLeaderboardVanity('admin')).toBeNull();
    expect(normalizeLeaderboardVanity('123456789012345678')).toBeNull();
    expect(RESERVED_LEADERBOARD_VANITIES.has('mock')).toBe(true);
  });

  it('validates format helper', () => {
    expect(validateLeaderboardVanityFormat(null)).toBe(true);
    expect(validateLeaderboardVanityFormat('')).toBe(true);
    expect(validateLeaderboardVanityFormat('ok-slug')).toBe(true);
    expect(validateLeaderboardVanityFormat('!!!')).not.toBe(true);
  });

  it('detects snowflake ids', () => {
    expect(isSnowflakeId('123456789012345678')).toBe(true);
    expect(isSnowflakeId('abc')).toBe(false);
  });
});
