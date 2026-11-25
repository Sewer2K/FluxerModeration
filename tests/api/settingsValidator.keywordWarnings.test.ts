import { validateSettingsUpdate } from '@/api/middleware/settingsValidator';

describe('validateSettingsUpdate keywordWarnings validation', () => {
  test('accepts valid keywordWarnings object payload', () => {
    const result = validateSettingsUpdate({
      keywordWarnings: {
        enabled: true,
        action: 'delete',
        keywords: [
          { pattern: 'six seven', isRegex: false, matchType: 'word', label: null, addedBy: null, action: 'mute' },
        ],
      },
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    const keywords = (result.sanitized.keywordWarnings as any).keywords;
    expect(keywords[0].matchType).toBe('word');
    expect(keywords[0].action).toBe('mute');
  });

  test('accepts enabled keyword warnings without keywords', () => {
    const result = validateSettingsUpdate({
      keywordWarnings: {
        enabled: true,
        action: 'warn',
        keywords: [],
      },
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('rejects non-object keywordWarnings payload', () => {
    const result = validateSettingsUpdate({
      keywordWarnings: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('keywordWarnings must be an object');
  });

  test('rejects invalid keyword warning entry shape', () => {
    const result = validateSettingsUpdate({
      keywordWarnings: {
        enabled: true,
        action: 'delete+warn',
        keywords: [{ pattern: '', isRegex: 'nope' }],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('keywordWarnings.keywords[].pattern');
  });

  test('rejects invalid matchType', () => {
    const result = validateSettingsUpdate({
      keywordWarnings: {
        enabled: true,
        action: 'delete',
        keywords: [{ pattern: 'paper', isRegex: false, matchType: 'substring' }],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('keywordWarnings.keywords[].matchType');
  });

  test('rejects invalid per-keyword action', () => {
    const result = validateSettingsUpdate({
      keywordWarnings: {
        enabled: true,
        action: 'delete',
        keywords: [{ pattern: 'paper', action: 'kick' }],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('keywordWarnings.keywords[].action');
  });
});
