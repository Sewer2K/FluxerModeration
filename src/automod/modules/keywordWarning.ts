import type { Message, Client } from '@fluxerjs/core';
import Warning from '@/models/Warning';
import ModerationLog from '@/models/ModerationLog';
import { logModAction } from '@/utils/logger';
import { buildKeywordMatcher } from '@/utils/keywordMatch';
import { t, normalizeLocale } from '@/i18n';
import type { IGuildSettings, IKeywordEntry, IKeywordWarningAutomodModule } from '@/types';
import { messageFromError } from '@/utils/messageFromError';
import isNetworkError from '@/utils/isNetworkError';
import * as moderationQueue from '@/utils/moderationQueue';
import { purgeWelcomeMessage } from '@/utils/welcomeMessageStore';
import { recordBanAppeal } from '@/utils/banAppeals';

const KEYWORD_MUTE_DURATION_MS = 10 * 60 * 1000;

async function check(message: Message, client: Client, settings: IGuildSettings): Promise<boolean> {
  const kw = settings?.keywordWarnings;
  if (!kw?.enabled || !kw.keywords?.length) return false;

  const content = message.content;
  if (!content) return false;

  let matched: IKeywordEntry | null = null;
  for (const entry of kw.keywords) {
    const matches = buildKeywordMatcher(entry);
    if (matches(content)) {
      matched = entry;
      break;
    }
  }

  if (!matched) return false;

  const action = matched.action && matched.action !== 'inherit' ? matched.action : (kw.action ?? 'delete+warn');
  const guild =
    message.guild ?? (message.guildId ? await client.guilds.fetch(message.guildId).catch(() => null) : null);
  if (!guild) return false;

  const author = message.author;
  const label = matched.label || matched.pattern;
  const reason = `Keyword filter: "${label}"`;

  if (action === 'delete' || action === 'delete+warn' || action === 'mute' || action === 'ban') {
    message.delete().catch(() => {});
  }

  if (action === 'warn' || action === 'delete+warn') {
    try {
      const warningRecord = await Warning.addWarning(guild.id, author.id, client.user?.id || 'automod', reason);
      const warningCount = warningRecord.warnings.length;

      await logModAction(guild, { id: 'automod', username: 'Automod' }, author, 'warn', reason, {
        fields: [
          {
            name: 'Trigger',
            value: matched.isRegex ? `regex: \`${matched.pattern}\`` : `"${matched.pattern}"`,
            inline: true,
          },
          { name: 'Total Warnings', value: `${warningCount}`, inline: true },
        ],
        client,
      });

      await ModerationLog.logAction({
        guildId: guild.id,
        targetId: author.id,
        userId: 'automod',
        action: 'warn',
        reason,
        metadata: { warningCount, keyword: matched.pattern },
      });

      author
        .send(
          t(normalizeLocale(settings?.language), 'auditCatalog.automod.modules.keywordWarning.l75_send', {
            'guild.name': guild.name,
            reason,
            warningCount,
          }),
        )
        .catch(() => {});
    } catch (err: unknown) {
      console.error(`[${guild.name}] Keyword warning failed: ${messageFromError(err)}`);
    }
  } else if (action === 'delete') {
    await logModAction(guild, { id: 'automod', username: 'Automod' }, author, 'delete', reason, {
      fields: [
        {
          name: 'Trigger',
          value: matched.isRegex ? `regex: \`${matched.pattern}\`` : `"${matched.pattern}"`,
          inline: true,
        },
      ],
      client,
    }).catch(() => {});
  } else if (action === 'mute' || action === 'ban') {
    try {
      if (action === 'ban') {
        await guild.ban(author.id, { reason, deleteMessageDays: 0 });
        await purgeWelcomeMessage(client, guild.id, author.id);
      } else {
        let member = guild.members?.get(author.id);
        if (!member) member = await guild.fetchMember(author.id);
        if (!member) throw new Error('Member not found');

        await member.edit({
          communicationDisabledUntil: new Date(Date.now() + KEYWORD_MUTE_DURATION_MS).toISOString(),
          timeoutReason: reason,
        });
      }

      const moderationAction = action === 'ban' ? 'ban' : 'timeout';
      await logModAction(guild, { id: 'automod', username: 'Automod' }, author, moderationAction, reason, {
        fields: [
          {
            name: 'Trigger',
            value: matched.isRegex ? `regex: \`${matched.pattern}\`` : `"${matched.pattern}"`,
            inline: true,
          },
        ],
        client,
      }).catch(() => {});

      const moderationLog = await ModerationLog.logAction({
        guildId: guild.id,
        targetId: author.id,
        userId: 'automod',
        action: moderationAction,
        reason,
        duration: action === 'mute' ? KEYWORD_MUTE_DURATION_MS : undefined,
        metadata: { keyword: matched.pattern },
      });

      if (action === 'ban') {
        await recordBanAppeal(client, {
          guildId: guild.id,
          userId: author.id,
          source: 'automod',
          banReason: reason,
          moderatorId: 'automod',
          permanent: true,
          caseNumber: moderationLog.metadata?.caseNumber,
          guildName: guild.name,
        }).catch(() => {});
      }
    } catch (err: unknown) {
      if (isNetworkError(err)) {
        moderationQueue.enqueue(guild.id, author.id, action === 'ban' ? 'ban' : 'timeout', {
          reason,
          deleteDays: 0,
          durationMs: KEYWORD_MUTE_DURATION_MS,
        });
      } else {
        console.error(`[${guild.name}] Keyword ${action} failed for ${author.id}: ${messageFromError(err)}`);
      }
    }
  }

  return true;
}

export default {
  name: 'keywordWarning',

  check,
} satisfies IKeywordWarningAutomodModule;
