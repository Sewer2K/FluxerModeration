import type { Client } from '@fluxerjs/core';
import config from '@/config';
import BanAppeal, { type BanAppealDocument } from '@/models/BanAppeal';
import settingsCache from '@/utils/settingsCache';
import { sendGuildEmbedViaBot } from '@/utils/sendGuildEmbed';
import { sendUserDm } from '@/utils/sendUserDm';
import type { IAppeals, IBanAppealAnswers, IBanAppealHistoryEntry, IGuildSettings } from '@/types';
import { signAppealToken } from '@/utils/appealToken';

export const APPEAL_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface BanAppealRecordInput {
  guildId: string;
  userId: string;
  source: 'command' | 'dashboard' | 'automod' | 'massban' | 'unknown';
  banReason: string;
  moderatorId: string;
  permanent: boolean;
  eligible?: boolean;
  caseNumber?: number | null;
  guildName?: string;
}

export interface AppealAnswersInput {
  whatHappened?: unknown;
  whyLift?: unknown;
  whatDifferent?: unknown;
  evidence?: unknown;
  onlyFluxerAccount?: unknown;
}

export const DEFAULT_APPEALS: IAppeals = {
  enabled: false,
  channelId: null,
  cooldownDays: 7,
  allowTempBans: false,
  defaultNoAppeal: false,
};

export function normalizeAppealSettings(value: Partial<IAppeals> | null | undefined): IAppeals {
  return {
    enabled: value?.enabled === true,
    channelId: typeof value?.channelId === 'string' && value.channelId ? value.channelId : null,
    cooldownDays:
      typeof value?.cooldownDays === 'number' && Number.isFinite(value.cooldownDays)
        ? Math.max(0, Math.min(365, Math.floor(value.cooldownDays)))
        : DEFAULT_APPEALS.cooldownDays,
    allowTempBans: value?.allowTempBans === true,
    defaultNoAppeal: value?.defaultNoAppeal === true,
  };
}

export function nextAppealEligibleAt(decision: 'deny' | 'dismiss', cooldownDays: number, now = new Date()): Date {
  const days = decision === 'dismiss' ? 1 : Math.max(0, cooldownDays);
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export function appealUrl(guildId: string, userId: string, now = Math.floor(Date.now() / 1000)): string | null {
  const origin = config.api.dashboardUrl?.replace(/\/$/, '');
  if (!origin || !config.api.appealSigningSecret) return null;

  const token = signAppealToken({ guildId, userId, exp: now + APPEAL_TOKEN_TTL_SECONDS });
  return `${origin}/appeal/${token}`;
}

export function parseAppealAnswers(
  input: Record<string, unknown>,
): { ok: true; answers: IBanAppealAnswers } | { ok: false; error: string } {
  const requiredKeys = ['whatHappened', 'whyLift', 'whatDifferent'] as const;
  const values = { whatHappened: '', whyLift: '', whatDifferent: '' };

  for (const key of requiredKeys) {
    if (typeof input[key] !== 'string') return { ok: false, error: `${key} is required` };
    const value = input[key].trim();
    if (!value) return { ok: false, error: `${key} is required` };
    if (value.length > 1000) return { ok: false, error: `${key} must be 1000 characters or fewer` };
    values[key] = value;
  }

  const evidence = typeof input.evidence === 'string' ? input.evidence.trim() : '';
  if (evidence.length > 1000) return { ok: false, error: 'evidence must be 1000 characters or fewer' };
  if (evidence) {
    const links = evidence.split(/\s+/);
    if (!links.every((link) => /^https?:\/\/[^\s]+$/i.test(link))) {
      return { ok: false, error: 'evidence must contain links only' };
    }
  }

  const onlyFluxerAccount = input.onlyFluxerAccount === null ? null : input.onlyFluxerAccount;
  if (
    onlyFluxerAccount !== null &&
    onlyFluxerAccount !== undefined &&
    onlyFluxerAccount !== 'yes' &&
    onlyFluxerAccount !== 'no'
  ) {
    return { ok: false, error: 'onlyFluxerAccount must be yes or no' };
  }

  return {
    ok: true,
    answers: {
      whatHappened: values.whatHappened,
      whyLift: values.whyLift,
      whatDifferent: values.whatDifferent,
      evidence,
      onlyFluxerAccount: onlyFluxerAccount ?? null,
    },
  };
}

export async function recordBanAppeal(client: Client, input: BanAppealRecordInput): Promise<string | null> {
  const settings = await settingsCache.get(input.guildId).catch(() => null);
  const appeals = normalizeAppealSettings(settings?.appeals);
  if (!appeals.enabled) return null;

  const current = await BanAppeal.findLatest(input.guildId, input.userId);
  const blacklisted = current?.state === 'blacklisted';
  const eligible =
    !blacklisted && input.eligible !== false && !appeals.defaultNoAppeal && (input.permanent || appeals.allowTempBans);
  const historyEntry: IBanAppealHistoryEntry = {
    at: new Date(),
    by: input.moderatorId,
    action: 'ban',
    note: input.banReason.slice(0, 1000),
  };

  await BanAppeal.findOneAndUpdate(
    { guildId: input.guildId, userId: input.userId },
    {
      $set: {
        caseNumber: input.caseNumber ?? null,
        source: input.source,
        banReason: input.banReason.slice(0, 1000),
        moderatorId: input.moderatorId,
        permanent: input.permanent,
        eligible,
        state: blacklisted ? 'blacklisted' : 'none',
        submittedAt: null,
        decidedAt: null,
        decidedBy: null,
        staffReason: '',
        nextEligibleAt: null,
      },
      $push: { history: { $each: [historyEntry], $slice: -20 } },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  if (!eligible) return null;

  const url = appealUrl(input.guildId, input.userId);
  if (!url) return null;

  await sendUserDm(
    client,
    input.userId,
    `You were banned from **${input.guildName || input.guildId}**. You can submit an appeal here: ${url}`,
  );
  return url;
}

export function appealChannelId(settings: IGuildSettings): string | null {
  const appeals = normalizeAppealSettings(settings.appeals);
  return appeals.channelId || settings.moderation?.logChannelId || settings.logChannelId || null;
}

export async function postAppealReview(
  client: Client,
  appeal: BanAppealDocument,
  settings: IGuildSettings,
): Promise<void> {
  const channelId = appealChannelId(settings);
  if (!channelId) return;

  const answer = appeal.answers;
  await sendGuildEmbedViaBot(client, channelId, {
    title: 'Ban appeal pending',
    color: 0xf59e0b,
    description: `A banned user submitted an appeal. Use \`${config.prefix}appeal view ${appeal.userId}\` to review it.`,
    fields: [
      { name: 'User ID', value: appeal.userId, inline: true },
      { name: 'Case', value: appeal.caseNumber ? `#${appeal.caseNumber}` : 'Unknown', inline: true },
      { name: 'Ban reason', value: appeal.banReason || 'No reason provided' },
      { name: 'What happened from their side?', value: answer.whatHappened },
      { name: 'Why should the ban be lifted?', value: answer.whyLift },
      { name: 'What will they do differently?', value: answer.whatDifferent },
      ...(answer.evidence ? [{ name: 'Evidence', value: answer.evidence }] : []),
      ...(answer.onlyFluxerAccount ? [{ name: 'Only Fluxer account?', value: answer.onlyFluxerAccount }] : []),
    ],
  });
}
