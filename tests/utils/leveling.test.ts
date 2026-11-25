import { capXpForMaxLevel, levelFromXp, totalXpForLevel, xpForLevel } from '@/utils/leveling/formula';
import { renderLevelUpMessage } from '@/utils/leveling/levelUp';
import {
  leaderboardSortField,
  levelForXp,
  parseLeaderboardPeriod,
  resolveMemberUsername,
} from '@/utils/leveling/memberXp';
import { normalizeLeaderboardVanity, validateLeaderboardVanityFormat } from '@/utils/leveling/leaderboardVanity';
import { GuildMember } from '@fluxerjs/core';

describe('leveling formula', () => {
  test('quadratic xp matches legacy curve at level 1', () => {
    expect(xpForLevel(1, { curve: 'quadratic', multiplier: 1, maxLevel: null })).toBe(155);
  });

  test('levelFromXp inverts totalXpForLevel', () => {
    const formula = { curve: 'quadratic' as const, multiplier: 1, maxLevel: null };
    const xp = totalXpForLevel(5, formula);
    expect(levelFromXp(xp, formula)).toBe(5);
  });

  test('display level is derived from current total xp', () => {
    const formula = { curve: 'linear' as const, multiplier: 1, maxLevel: null };
    expect(levelForXp(totalXpForLevel(3, formula), formula)).toBe(3);
    expect(levelForXp(totalXpForLevel(3, formula) + 1, formula)).toBe(3);
  });

  test('capXpForMaxLevel respects maxLevel', () => {
    const formula = { curve: 'linear' as const, multiplier: 1, maxLevel: 3 };
    const cap = totalXpForLevel(3, formula);
    expect(capXpForMaxLevel(cap + 500, formula)).toBe(cap);
  });
});

describe('level up message', () => {
  test('replaces Fluxer mention tags', () => {
    const text = renderLevelUpMessage('{user.mention} hit {user.level}', {
      userId: '1474069931333816428',
      username: 'testuser',
      level: 7,
      xp: 900,
    });
    expect(text).toBe('<@1474069931333816428> hit 7');
  });

  test('earned role block uses role mention', () => {
    const text = renderLevelUpMessage('Nice {earned:You earned {mention}!}', {
      userId: '1',
      username: 'a',
      level: 2,
      xp: 50,
      earnedRoleId: '99',
      earnedRoleName: 'Helper',
    });
    expect(text).toBe('Nice You earned <@&99>!');
  });
});

describe('leaderboard vanity', () => {
  test('accepts claudecitymod-style slug', () => {
    expect(normalizeLeaderboardVanity('claudecitymod-support')).toBe('claudecitymod-support');
  });

  test('rejects reserved slugs', () => {
    expect(normalizeLeaderboardVanity('admin')).toBeNull();
  });

  test('validate allows empty', () => {
    expect(validateLeaderboardVanityFormat('')).toBe(true);
  });
});

describe('member helpers', () => {
  test('parseLeaderboardPeriod aliases', () => {
    expect(parseLeaderboardPeriod('w')).toBe('weekly');
    expect(parseLeaderboardPeriod('month')).toBe('monthly');
    expect(parseLeaderboardPeriod('nope')).toBeNull();
  });

  test('leaderboardSortField maps periods', () => {
    expect(leaderboardSortField('weekly')).toBe('weeklyXp');
    expect(leaderboardSortField('all')).toBe('xp');
  });

  test('resolveMemberUsername prefers nickname over display name and username', () => {
    expect(
      resolveMemberUsername(
        {
          nick: 'Server Nick',
          user: { id: '1', username: 'testuser', globalName: 'testuser ✦' },
        } as GuildMember,
        '1',
      ),
    ).toBe('Server Nick');
  });

  test('resolveMemberUsername falls back to display name then username', () => {
    expect(
      resolveMemberUsername({ user: { id: '1', username: 'testuser', globalName: 'testuser ✦' } } as GuildMember, '1'),
    ).toBe('testuser ✦');
    expect(resolveMemberUsername({ user: { id: '1', username: 'testuser' } } as GuildMember, '1')).toBe('testuser');
  });
});
