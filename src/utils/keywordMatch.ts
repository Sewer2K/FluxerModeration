export type KeywordMatchType = 'any' | 'word';

export interface KeywordMatchEntry {
  pattern: string;
  isRegex?: boolean;
  matchType?: KeywordMatchType;
}

export function buildKeywordMatcher(entry: KeywordMatchEntry): (content: string) => boolean {
  if (entry.isRegex) {
    try {
      const re = new RegExp(entry.pattern, 'i');
      return (content: string) => {
        if (content.length > 5000) return false;
        try {
          return re.test(content);
        } catch {
          return false;
        }
      };
    } catch {
      return () => false;
    }
  }

  const lower = entry.pattern.toLowerCase();
  if (entry.matchType === 'word') {
    const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    return (content: string) => re.test(content);
  }

  return (content: string) => content.toLowerCase().includes(lower);
}

export function keywordMatchLabel(matchType: KeywordMatchType | undefined): string {
  return matchType === 'word' ? 'whole word' : 'contains';
}
