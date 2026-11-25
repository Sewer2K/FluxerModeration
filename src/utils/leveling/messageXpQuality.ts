import type { IMessageXpQualitySettings } from '@/types/Leveling';

export interface MessageXpQualityInput {
  guildId: string;
  userId: string;
  content: string;
  wordCount: number;
  isCommand: boolean;
  hasAttachments: boolean;
  hasStickers: boolean;
}

export type MessageXpQualityReason =
  | 'command'
  | 'attachment_only'
  | 'emoji_only'
  | 'too_short'
  | 'too_few_words'
  | 'low_unique_chars'
  | 'burst'
  | 'duplicate';

export interface MessageXpQualityResult {
  allowed: boolean;
  reason?: MessageXpQualityReason;
}

const duplicateHistory = new Map<string, Array<{ fingerprint: string; at: number }>>();
const burstTracker = new Map<string, number[]>();
const MAX_TRACKED_USERS = 50_000;

function userKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function pruneTracker<T>(map: Map<string, T>, maxSize: number): void {
  if (map.size <= maxSize) return;
  const drop = map.size - maxSize;
  let i = 0;
  for (const key of map.keys()) {
    map.delete(key);
    if (++i >= drop) break;
  }
}

export function normalizeMessageFingerprint(content: string): string {
  return content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '');
}

function countUniqueCharacters(content: string): number {
  return new Set(content.replace(/\s/g, '').toLowerCase()).size;
}

function isEmojiOnlyContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;

  const withoutCustomEmoji = trimmed.replace(/<a?:\w+:\d+>/g, '');
  const withoutEmoji = withoutCustomEmoji.replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, '').replace(/\s/g, '');
  return withoutEmoji.length === 0;
}

export function evaluateMessageXpQuality(
  quality: IMessageXpQualitySettings,
  input: MessageXpQualityInput,
): MessageXpQualityResult {
  if (!quality.enabled) return { allowed: true };

  const content = input.content?.trim() ?? '';
  const attachmentOnly = input.hasAttachments && !content;

  if (quality.ignoreCommands && input.isCommand) {
    return { allowed: false, reason: 'command' };
  }

  if (quality.ignoreOnlyAttachments && attachmentOnly) {
    return { allowed: false, reason: 'attachment_only' };
  }

  if (quality.ignoreOnlyEmojis && content && isEmojiOnlyContent(content)) {
    return { allowed: false, reason: 'emoji_only' };
  }

  // Attachment-only messages have no text to measure. When the explicit
  // attachment toggle is off, let them skip text-only thresholds while still
  // applying the burst and duplicate protections below.
  if (!attachmentOnly) {
    if (content.length < quality.minCharacters) {
      return { allowed: false, reason: 'too_short' };
    }

    const words = input.wordCount || (content ? content.split(/\s+/).filter(Boolean).length : 0);
    if (words < quality.minWords) {
      return { allowed: false, reason: 'too_few_words' };
    }

    if (countUniqueCharacters(content) < quality.minUniqueCharacters) {
      return { allowed: false, reason: 'low_unique_chars' };
    }
  }

  const key = userKey(input.guildId, input.userId);
  const now = Date.now();

  let bursts = burstTracker.get(key) ?? [];
  bursts = bursts.filter((ts) => now - ts < quality.burstWindowSeconds * 1000);
  bursts.push(now);
  burstTracker.set(key, bursts);
  pruneTracker(burstTracker, MAX_TRACKED_USERS);

  if (bursts.length > quality.burstMaxMessages) {
    return { allowed: false, reason: 'burst' };
  }

  const fingerprint = normalizeMessageFingerprint(content);
  let history = duplicateHistory.get(key) ?? [];
  history = history.filter((entry) => now - entry.at < quality.duplicateWindowSeconds * 1000);
  const priorMatches = history.filter((entry) => entry.fingerprint === fingerprint).length;
  history.push({ fingerprint, at: now });
  duplicateHistory.set(key, history);
  pruneTracker(duplicateHistory, MAX_TRACKED_USERS);

  if (priorMatches >= quality.maxDuplicateMatches) {
    return { allowed: false, reason: 'duplicate' };
  }

  return { allowed: true };
}

export function resetMessageXpQualityStateForTests(): void {
  duplicateHistory.clear();
  burstTracker.clear();
}
