import { buildKeywordMatcher } from '@/utils/keywordMatch';

describe('buildKeywordMatcher', () => {
  test('contains mode matches substrings', () => {
    const matches = buildKeywordMatcher({ pattern: 'paper', matchType: 'any' });
    expect(matches('paperbag')).toBe(true);
    expect(matches('buy paper')).toBe(true);
  });

  test('whole word mode does not match substrings', () => {
    const matches = buildKeywordMatcher({ pattern: 'paper', matchType: 'word' });
    expect(matches('paperbag')).toBe(false);
    expect(matches('a paper here')).toBe(true);
  });

  test('regex mode ignores matchType', () => {
    const matches = buildKeywordMatcher({ pattern: 'pap(er|erbag)', isRegex: true, matchType: 'word' });
    expect(matches('paperbag')).toBe(true);
  });
});
