import { EmbedBuilder } from '@fluxerjs/core';
import type { Client, Guild, GuildMember } from '@fluxerjs/core';
import { PublicUserFlags } from '@fluxerjs/types';
import config from '@/config';
import { sendUserDm } from './sendUserDm';
import { t } from '@/i18n';
import { snowflakeToDate } from './snowflakeDate';

export const SUSPICIOUS_ALERT_THRESHOLD = 30;

const BATCH_SIZE = 3;
const BATCH_WINDOW_MS = 60_000;
const SINGLE_ALERT_COOLDOWN_MS = 2 * 60_000;
const USER_DEDUP_MS = 10 * 60_000;
const PROFILE_CACHE_TTL_MS = 10 * 60_000;
const COHORT_WINDOW_MS = 10 * 60_000;
const MESSAGE_WINDOW_MS = 15_000;
const EARLY_MESSAGE_WINDOW_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

const CONFUSABLES: Record<string, string> = {
  '\u0430': 'a',
  '\u0435': 'e',
  '\u043e': 'o',
  '\u0440': 'p',
  '\u0441': 'c',
  '\u0443': 'y',
  '\u0445': 'x',
  '\u0456': 'i',
  '\u0458': 'j',
  '\u0455': 's',
  '\u03bd': 'v',
  '\u03c5': 'y',
  '\u03bf': 'o',
  '\u03c1': 'p',
};

const SCAM_PHRASES: Array<{ label: string; pattern: RegExp; score: number }> = [
  { label: 'Free plutonium promotion', pattern: /\bfree[\s._-]+plutonium\b/iu, score: 18 },
  {
    label: 'Plutonium giveaway language',
    pattern: /\bplutonium\b.{0,24}\b(?:giveaway|drop|claim|generator)\b/iu,
    score: 16,
  },
  {
    label: 'Fluxer support impersonation',
    pattern: /\b(?:official\s+)?fluxer\s*(?:support|staff|admin|moderation|security)\b/iu,
    score: 16,
  },
  {
    label: 'Support impersonation language',
    pattern:
      /\b(?:official|staff|support|admin|moderation|security)\b.{0,18}\b(?:account|appeal|verification|verify|claim)\b/iu,
    score: 10,
  },
];

const SHORTENER_HOSTS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'is.gd', 'cutt.ly', 'rebrand.ly', 'ow.ly']);

interface SuspectEntry {
  userId: string;
  username: string;
  score: number;
  reasons: string[];
  accountAgeDays: number | null;
  timestamp: number;
}

export interface SuspiciousProfileData {
  bio?: string | null;
}

export interface SuspicionAssessment {
  score: number;
  reasons: string[];
  accountAgeDays: number | null;
  profileFetched: boolean;
}

export interface MessageSuspicionInput {
  content?: string | null;
  hasAttachment?: boolean;
}

interface CohortEntry {
  userId: string;
  nameKey: string;
  bioKey: string;
  avatar: string | null;
  timestamp: number;
}

interface MessageCohortEntry {
  userId: string;
  timestamp: number;
}

const suspectBuffers = new Map<string, SuspectEntry[]>();
const lastSingleAlert = new Map<string, number>();
const recentlyAlerted = new Map<string, number>();
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const profileCache = new Map<string, { profile: SuspiciousProfileData | null; expiresAt: number }>();
const profileFetches = new Map<string, Promise<SuspiciousProfileData | null>>();
const cohortEntries = new Map<string, CohortEntry[]>();
const memberJoinTimes = new Map<string, Map<string, number>>();
const messageCohorts = new Map<string, Map<string, MessageCohortEntry[]>>();

export function normalizeSuspiciousText(value: string): string {
  return Array.from(value.normalize('NFKC').normalize('NFD'))
    .filter((character) => !/\p{Mark}/u.test(character))
    .map((character) => CONFUSABLES[character] ?? character)
    .join('')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function identityKey(value: string): string {
  return normalizeSuspiciousText(value).replace(/\s+/g, '').replace(/\d+$/g, '');
}

function identitySimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 4 || right.length < 4) return 0;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    let diagonal = previous[0]!;
    previous[0] = row;
    for (let column = 1; column <= right.length; column++) {
      const above = previous[column]!;
      previous[column] =
        left[row - 1] === right[column - 1] ? diagonal : Math.min(diagonal, above, previous[column - 1]!) + 1;
      diagonal = above;
    }
  }

  return 1 - previous[right.length]! / Math.max(left.length, right.length);
}

export function areSuspiciousNamesSimilar(left: string, right: string): boolean {
  return identitySimilarity(identityKey(left), identityKey(right)) >= 0.82;
}

function extractLinks(value: string): string[] {
  return value.match(/(?:https?:\/\/|www\.)[^\s<>()]+/giu) ?? [];
}

function getHostname(link: string): string | null {
  try {
    const parsed = new URL(link.startsWith('www.') ? `https://${link}` : link);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function scoreText(
  value: string,
  source: 'profile' | 'message',
): { score: number; reasons: string[]; hasPhrase: boolean } {
  if (!value.trim()) return { score: 0, reasons: [], hasPhrase: false };

  let score = 0;
  const reasons: string[] = [];
  let hasPhrase = false;

  for (const phrase of SCAM_PHRASES) {
    if (phrase.pattern.test(value)) {
      score += phrase.score;
      reasons.push(`${phrase.label} (+${phrase.score})`);
      hasPhrase = true;
    }
  }

  const links = extractLinks(value);
  if (links.length > 0) {
    const hosts = links.map(getHostname).filter((host): host is string => Boolean(host));
    const linkScore = source === 'profile' ? 6 : 5;
    score += linkScore;
    reasons.push(`${source === 'profile' ? 'Profile' : 'Message'} contains a link (+${linkScore})`);

    if (hosts.some((host) => SHORTENER_HOSTS.has(host))) {
      score += 8;
      reasons.push('URL shortener link (+8)');
    }

    if (hosts.some((host) => host === 'discord.gg' || host.endsWith('.discord.gg'))) {
      score += 5;
      reasons.push('Discord invite link (+5)');
    }
  }

  if (hasPhrase && links.length > 0) {
    score += 8;
    reasons.push('Promotional/support language paired with a link (+8)');
  }

  return { score, reasons, hasPhrase };
}

export function scoreProfile(profile: SuspiciousProfileData | null | undefined): { score: number; reasons: string[] } {
  const result = scoreText(profile?.bio ?? '', 'profile');
  return { score: result.score, reasons: result.reasons };
}

export function scoreMessageContent(input: MessageSuspicionInput): { score: number; reasons: string[] } {
  const content = input.content ?? '';
  const result = scoreText(content, 'message');
  let score = result.score;
  const reasons = [...result.reasons];

  if (input.hasAttachment) {
    score += 3;
    reasons.push('Attachment from a monitored account (+3)');
  }

  if (/@(?:everyone|here)\b/iu.test(content)) {
    score += 8;
    reasons.push('Mass mention in message (+8)');
  }

  return { score, reasons };
}

function getAccountAgeDays(userId: string | undefined): number | null {
  if (!userId) return null;
  const createdAt = snowflakeToDate(userId);
  return createdAt ? (Date.now() - createdAt.getTime()) / DAY_MS : null;
}

export function scoreMember(member: GuildMember): {
  score: number;
  reasons: string[];
  accountAgeDays: number | null;
} {
  const user = member.user || member;
  const username: string = user.username || user.globalName || '';
  const displayName: string = user.globalName || '';
  let score = 0;
  const reasons: string[] = [];

  if (((user.flags ?? 0) & PublicUserFlags.Spammer) === PublicUserFlags.Spammer) {
    score += 60;
    reasons.push('Fluxer marks the account as a spammer (+60)');
  }

  const accountAgeDays = getAccountAgeDays(user.id);
  if (accountAgeDays !== null) {
    if (accountAgeDays < 1) {
      score += 20;
      reasons.push('Account < 24 hours old (+20)');
    } else if (accountAgeDays < 3) {
      score += 15;
      reasons.push('Account < 3 days old (+15)');
    } else if (accountAgeDays < 7) {
      score += 9;
      reasons.push('Account < 7 days old (+9)');
    } else if (accountAgeDays < 30) {
      score += 3;
      reasons.push('Account < 30 days old (+3)');
    }
  }

  if (!user.avatar) {
    score += 2;
    reasons.push('No custom avatar (+2)');
  }

  const identityText = `${username} ${displayName}`;
  const identitySignals = scoreText(identityText, 'profile');
  if (identitySignals.hasPhrase) {
    score += Math.min(identitySignals.score, 16);
    reasons.push(...identitySignals.reasons.map((reason) => `Name: ${reason}`));
  }

  return { score, reasons, accountAgeDays };
}

function recordMemberCohort(
  guildId: string,
  member: GuildMember,
  profile: SuspiciousProfileData | null,
): {
  score: number;
  reasons: string[];
} {
  const user = member.user || member;
  const userId = user.id || member.id;
  const nameKey = identityKey(`${user.username || ''} ${user.globalName || ''}`);
  const bioKey = profile?.bio ? identityKey(profile.bio) : '';
  const avatar = user.avatar || null;
  const now = Date.now();
  const existing = (cohortEntries.get(guildId) ?? []).filter(
    (entry) => entry.userId !== userId && now - entry.timestamp <= COHORT_WINDOW_MS,
  );

  const nameMatches = existing.filter(
    (entry) => nameKey && entry.nameKey && identitySimilarity(nameKey, entry.nameKey) >= 0.82,
  );
  const bioMatches = existing.filter((entry) => bioKey && entry.bioKey && bioKey === entry.bioKey);
  const avatarMatches = existing.filter((entry) => avatar && entry.avatar && avatar === entry.avatar);
  const matchedUsers = new Set([...nameMatches, ...bioMatches, ...avatarMatches].map((entry) => entry.userId));
  const reasons: string[] = [];
  let score = 0;

  if (nameMatches.length > 0) {
    score += 10;
    reasons.push(`Name resembles ${nameMatches.length} recent joiner(s) (+10)`);
  }
  if (bioMatches.length > 0) {
    score += 8;
    reasons.push(`Bio repeats ${bioMatches.length} recent joiner(s) (+8)`);
  }
  if (avatarMatches.length > 0) {
    score += 8;
    reasons.push(`Avatar matches ${avatarMatches.length} recent joiner(s) (+8)`);
  }
  if (matchedUsers.size >= 2) {
    score += 8;
    reasons.push(`Multiple profile signals match ${matchedUsers.size} recent joiner(s) (+8)`);
  }

  existing.push({ userId, nameKey, bioKey, avatar, timestamp: now });
  cohortEntries.set(guildId, existing);
  return { score, reasons };
}

async function fetchSuspiciousProfile(
  client: Client,
  userId: string,
  guildId: string,
): Promise<SuspiciousProfileData | null> {
  const cacheKey = `${guildId}:${userId}`;
  const cached = profileCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;

  const activeFetch = profileFetches.get(cacheKey);
  if (activeFetch) return activeFetch;

  const fetchPromise = client.users
    .fetchWithProfile(userId, { guildId })
    .then((result) => {
      const profile = result.globalProfile?.userProfile ?? result.serverProfile?.userProfile ?? null;
      const data = profile ? { bio: profile.bio ?? null } : null;
      profileCache.set(cacheKey, { profile: data, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
      return data;
    })
    .catch(() => null)
    .finally(() => {
      profileFetches.delete(cacheKey);
    });

  profileFetches.set(cacheKey, fetchPromise);
  return fetchPromise;
}

export async function assessMember(client: Client, guild: Guild, member: GuildMember): Promise<SuspicionAssessment> {
  const user = member.user || member;
  const userId = user.id || member.id;
  const base = scoreMember(member);

  if (user.bot || user.system || !userId) {
    return { ...base, profileFetched: false };
  }

  const profile = await fetchSuspiciousProfile(client, userId, guild.id);
  const profileScore = scoreProfile(profile);
  const cohortScore = recordMemberCohort(guild.id, member, profile);
  recordMemberJoin(guild.id, userId);

  return {
    score: base.score + profileScore.score + cohortScore.score,
    reasons: [...base.reasons, ...profileScore.reasons, ...cohortScore.reasons],
    accountAgeDays: base.accountAgeDays,
    profileFetched: profile !== null,
  };
}

export function recordMemberJoin(guildId: string, userId: string, timestamp = Date.now()): void {
  let joins = memberJoinTimes.get(guildId);
  if (!joins) {
    joins = new Map();
    memberJoinTimes.set(guildId, joins);
  }
  joins.set(userId, timestamp);
}

export function observeMessage(
  guildId: string,
  userId: string,
  input: MessageSuspicionInput,
): {
  score: number;
  reasons: string[];
} {
  const result = scoreMessageContent(input);
  let score = result.score;
  const reasons = [...result.reasons];
  const now = Date.now();
  const joinTime = memberJoinTimes.get(guildId)?.get(userId);

  if (joinTime && now - joinTime <= EARLY_MESSAGE_WINDOW_MS) {
    score += 6;
    reasons.push('Message sent soon after joining (+6)');
  }

  const normalized = normalizeSuspiciousText(input.content ?? '');
  if (normalized.length >= 8) {
    let guildMessages = messageCohorts.get(guildId);
    if (!guildMessages) {
      guildMessages = new Map();
      messageCohorts.set(guildId, guildMessages);
    }

    const recent = (guildMessages.get(normalized) ?? []).filter(
      (entry) => now - entry.timestamp <= MESSAGE_WINDOW_MS && entry.userId !== userId,
    );
    if (recent.length > 0) {
      score += 8;
      reasons.push(`Message matches ${recent.length} recent user(s) (+8)`);
    }
    recent.push({ userId, timestamp: now });
    guildMessages.set(normalized, recent);
  }

  return { score, reasons };
}

export function clearSuspicionState(guildId: string): void {
  cohortEntries.delete(guildId);
  memberJoinTimes.delete(guildId);
  messageCohorts.delete(guildId);
  for (const key of profileCache.keys()) {
    if (key.startsWith(`${guildId}:`)) profileCache.delete(key);
  }
}

export function checkAndAlert(
  client: Client,
  guild: Guild,
  member: GuildMember,
  score: number,
  reasons: string[],
  accountAgeDays: number | null,
): void {
  const user = member.user || member;
  const userId: string = user.id || member.id;
  const username: string = user.username || user.globalName || userId;
  const now = Date.now();

  const lastAlerted = recentlyAlerted.get(userId);
  if (lastAlerted && now - lastAlerted < USER_DEDUP_MS) return;

  const guildId: string = guild.id;
  let buffer = suspectBuffers.get(guildId);
  if (!buffer) {
    buffer = [];
    suspectBuffers.set(guildId, buffer);
  }

  const cutoff = now - BATCH_WINDOW_MS;
  while ('0' in buffer && buffer[0].timestamp < cutoff) buffer.shift();

  const entry: SuspectEntry = { userId, username, score, reasons, accountAgeDays, timestamp: now };
  buffer.push(entry);
  recentlyAlerted.set(userId, now);

  if (buffer.length >= BATCH_SIZE) {
    for (const entryToUpdate of buffer) {
      if (!entryToUpdate.reasons.some((reason) => reason.includes('Burst'))) {
        entryToUpdate.score += 10;
        entryToUpdate.reasons.push(`Burst: ${buffer.length} suspects in 60s (+10)`);
      }
    }
    clearFlushTimer(guildId);
    const batch = [...buffer];
    buffer.length = 0;
    sendSuspectAlert(client, guild, batch).catch(() => {});
    return;
  }

  if (!flushTimers.has(guildId)) {
    const timer = setTimeout(() => {
      flushTimers.delete(guildId);
      const currentBuffer = suspectBuffers.get(guildId);
      if (!currentBuffer || currentBuffer.length === 0) return;

      const lastSingle = lastSingleAlert.get(guildId);
      if (lastSingle && Date.now() - lastSingle < SINGLE_ALERT_COOLDOWN_MS) return;
      lastSingleAlert.set(guildId, Date.now());

      const toSend = [...currentBuffer];
      currentBuffer.length = 0;
      sendSuspectAlert(client, guild, toSend).catch(() => {});
    }, 10_000);
    flushTimers.set(guildId, timer);
  }
}

async function sendSuspectAlert(client: Client, guild: Guild, suspects: SuspectEntry[]): Promise<void> {
  if (suspects.length === 0) return;

  const lines = suspects.map((suspect) => {
    const age =
      suspect.accountAgeDays !== null
        ? suspect.accountAgeDays < 1
          ? '< 1 day'
          : `${Math.floor(suspect.accountAgeDays)}d`
        : '?';
    return `\`${suspect.userId}\` **${suspect.username}** - score ${suspect.score}, age ${age}\n> ${suspect.reasons.join(', ')}`;
  });

  const idList = suspects
    .map((suspect) => suspect.userId)
    .join(',')
    .slice(0, 900);

  const ownerEmbed = new EmbedBuilder()
    .setTitle(
      t('en', 'auditCatalog.utils.suspiciousDetector.l153_setTitle', {
        "suspects.length > 1 ? 's' : ''": suspects.length > 1 ? 's' : '',
        'guild.name': guild.name,
      }),
    )
    .setDescription(
      `**${suspects.length}** suspicious account${suspects.length > 1 ? 's' : ''} joined **${guild.name}** (\`${guild.id}\`)\n\n` +
        lines.join('\n\n'),
    )
    .addFields({
      name: t('en', 'auditCatalog.utils.suspiciousDetector.l159_addFields_name'),
      value: `\`\`\`\n!globalban add ${idList} Suspicious Fluxer account\n\`\`\``,
      inline: false,
    })
    .setColor(0xffa500)
    .setTimestamp(new Date());

  if (config.ownerId) await sendUserDm(client, config.ownerId, { embeds: [ownerEmbed] }).catch(() => {});

  const guildOwnerId = guild.ownerId;
  if (guildOwnerId && guildOwnerId !== config.ownerId) {
    const guildOwnerEmbed = new EmbedBuilder()
      .setTitle(t('en', 'auditCatalog.utils.suspiciousDetector.l177_setTitle', { 'guild.name': guild.name }))
      .setDescription(
        `**${suspects.length}** suspicious account${suspects.length > 1 ? 's' : ''} joined your server.\n` +
          `These accounts matched Fluxer profile, coordination, link, or early-behavior signals.\n\n` +
          suspects
            .map(
              (suspect) =>
                `**${suspect.username}** (\`${suspect.userId}\`) - age ${suspect.accountAgeDays !== null ? (suspect.accountAgeDays < 1 ? '< 1 day' : `${Math.floor(suspect.accountAgeDays)}d`) : '?'}`,
            )
            .join('\n'),
      )
      .setColor(0xffa500)
      .setFooter({ text: t('en', 'auditCatalog.utils.suspiciousDetector.l184_setFooter') })
      .setTimestamp(new Date());

    await sendUserDm(client, guildOwnerId, { embeds: [guildOwnerEmbed] }).catch(() => {});
  }

  console.warn(
    `[suspect-detect] ALERT: ${suspects.length} suspect(s) in ${guild.name} (${guild.id}): ` +
      suspects.map((suspect) => `${suspect.username}(${suspect.userId})`).join(', '),
  );
}

function clearFlushTimer(guildId: string): void {
  const timer = flushTimers.get(guildId);
  if (timer) {
    clearTimeout(timer);
    flushTimers.delete(guildId);
  }
}

setInterval(() => {
  const cutoff = Date.now() - USER_DEDUP_MS;
  for (const [id, timestamp] of recentlyAlerted) {
    if (timestamp < cutoff) recentlyAlerted.delete(id);
  }
}, 30 * 60_000).unref?.();

setInterval(() => {
  const cutoff = Date.now() - COHORT_WINDOW_MS;
  for (const [guildId, entries] of cohortEntries) {
    const current = entries.filter((entry) => entry.timestamp >= cutoff);
    if (current.length > 0) cohortEntries.set(guildId, current);
    else cohortEntries.delete(guildId);
  }
  for (const [guildId, joins] of memberJoinTimes) {
    for (const [userId, timestamp] of joins) {
      if (timestamp < Date.now() - EARLY_MESSAGE_WINDOW_MS) joins.delete(userId);
    }
    if (joins.size === 0) memberJoinTimes.delete(guildId);
  }
}, 60_000).unref?.();
