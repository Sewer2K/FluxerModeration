import { Router, type RequestHandler } from 'express';
import type { Channel, Client, Guild, MessageSendOptions, Role } from '@fluxerjs/core';
import { EmbedBuilder, PermissionFlags } from '@fluxerjs/core';
import { APIChannel, APIGuild, APIMessage, APIRole, Routes } from '@fluxerjs/types';
import type { AuthRequest } from '../middleware/auth';
import GuildSettings from '@/models/GuildSettings';
import config from '@/config';
import log from '@/utils/consoleLogger';
import settingsCache from '@/utils/settingsCache';
import { uploadsRoot } from '@/utils/uploads';
import { isGuildAllowed } from '@/utils/accessControl';
import { broadcastSettingsUpdate } from '../ws/settingsWs';
import { generateTranscriptHtml } from '@/utils/transcriptGenerator';
import { validateSettingsUpdate } from '../middleware/settingsValidator';
import { t, normalizeLocale } from '@/i18n';
import { encodeReactionForRoute } from '@/utils/encodeReactionForRoute';
import RssFeedState from '@/models/RssFeedState';
import { fetchFeed } from '@/utils/rssFeed';
import { findLeaderboardVanityConflict } from '@/utils/leveling/leaderboardVanity';
import { normalizeLevelingSettings } from '@/types/Leveling';
import { validateEmbedPayload, parseWebhookTarget } from '@/utils/embedPayload';
import { sendGuildEmbedViaBot, sendGuildEmbedViaWebhook } from '@/utils/sendGuildEmbed';
import { notifyBotSettingsInvalidated } from '../notifyBotSettingsCache';
import { isGuildChannel } from '@/utils/isGuildChannel';
import { getChannelGuildId } from '@/utils/getGuildChannel';
import { isArray } from '@/utils/isArray';
import { isTextChannel } from '@/utils/isTextChannel';
import { isGuildTextChannel } from '@/utils/isGuildTextChannel';
import type { BotClient, IVerification } from '@/types';
import { generateRankCard } from '@/utils/leveling/rankCard';
import LevelProfile from '../../models/LevelProfile';
import { renderLevelUpMessage } from '@/utils/leveling';
import { levelForXp } from '@/utils/leveling/memberXp';
import { messageFromError } from '@/utils/messageFromError';
import { isSendCapable, sendMessage } from '@/utils/sendMessage';
import * as bgImageCache from '@/utils/bgImageCache';
import { fluxerApiUrl } from '@/utils/fluxerUrls';

async function syncGuildSettingsCache(guildId: string): Promise<void> {
  settingsCache.invalidate(guildId);
  await notifyBotSettingsInvalidated(guildId);
}

const ALLOWED_SETTINGS_FIELDS = new Set([
  'prefixes',
  'language',
  'welcomeMessage',
  'reactionRoles',
  'moderation',
  'appeals',
  'automod',
  'automodEnabled',
  'antiLink',
  'antiSpam',
  'antiGhostPing',
  'logChannelId',
  'muteRoleId',
  'prefix',
  'reactionRoleDMEnabled',
  'autoroleId',
  'raidDisableAutorole',
  'staffChannelId',
  'staffRoleId',
  'staffInboxChannelId',
  'keywordWarnings',
  'honeypotChannels',
  'honeypotAlertRoleId',
  'stickyMessages',
  'serverLogChannelId',
  'logChannelOverrides',
  'disabledLogEvents',
  'messageLogIncludeLinks',
  'blacklistedChannels',
  'ticketCategoryId',
  'ticketSupportRoleId',
  'ticketSupportRoleIds',
  'ticketLogChannelId',
  'ticketMaxOpen',
  'ticketOpenMessage',
  'ticketSetupChannelId',
  'ticketSetupMessageId',
  'ticketEmoji',
  'customCommands',
  'lockdownRoles',
  'goodbyeMessage',
  'lockdownAllowedRoles',
  'lockdownAllowedUsers',
  'slowmodeAllowedRoles',
  'commandAllowedRoles',
  'globalBanEnabled',
  'globalBanAutoApply',
  'disabledCommands',
  'onboardingComplete',
  'onboardingStep',
  'verification',
  'rss',
  'starboard',
  'starboards',
  'leveling',
]);

function sanitizeUpdates(body: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_SETTINGS_FIELDS.has(key)) {
      clean[key] = body[key];
    }
  }
  return clean;
}

function asArray<T>(value: T[] | Record<string, T> | null | undefined): T[] {
  if (isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function getGuildChannelCacheFallback(client: Client, guild: Guild, guildId: string) {
  const cachedGuildChannels = Array.from(guild.channels.values());
  if (cachedGuildChannels.length > 0) return cachedGuildChannels;

  const cachedClientChannels = Array.from(client.channels.values()).filter((channel) => {
    const channelGuildId = getChannelGuildId(channel);
    return channelGuildId === guildId;
  });

  if (cachedClientChannels.length > 0) {
    for (const channel of cachedClientChannels) {
      if (!isGuildChannel(channel)) continue;
      guild.channels.set(channel.id, channel);
    }
  }

  return cachedClientChannels;
}

function guildsT(key: string, vars?: Record<string, string | number>): string {
  return t('en', `auditCatalog.api.routes.guilds.${key}`, vars);
}

export function createGuildsRouter(
  client: BotClient,
  requireGuildAccess: RequestHandler,
  requireBotOnline: RequestHandler,
): Router {
  const router = Router();

  router.get('/', async (req: AuthRequest, res) => {
    try {
      const token = req.fluxerToken;
      if (!token) {
        res.status(403).json({ error: guildsT('guildListingRequiresOauth') });
        return;
      }

      const userGuildsRes = await fetch(fluxerApiUrl('/users/@me/guilds'), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!userGuildsRes.ok) {
        res.status(502).json({ error: guildsT('fetchUserGuildsFailed') });
        return;
      }

      const userGuilds = (await userGuildsRes.json()) as Array<{
        id: string;
        name: string;
        icon?: string | null;
        owner_id?: string;
        permissions?: string | null;
      }>;

      const userId = req.userId;
      const manageable = userGuilds.filter((ug) => {
        if (ug.owner_id === userId) return true;
        const perms = ug.permissions ? BigInt(ug.permissions) : 0n;
        return (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n;
      });

      const { fetchAllGuildIds } = client;
      const allBotGuildIds: Set<string> = fetchAllGuildIds ? await fetchAllGuildIds() : new Set(client.guilds.keys());

      const result = manageable.map((ug) => {
        const botGuild = client.guilds.get(ug.id);
        if (botGuild) {
          return {
            id: botGuild.id,
            name: botGuild.name,
            icon: botGuild.icon || null,
            botPresent: true,
          };
        }
        if (allBotGuildIds.has(ug.id)) {
          return {
            id: ug.id,
            name: ug.name,
            icon: ug.icon || null,
            botPresent: true,
          };
        }
        return {
          id: ug.id,
          name: ug.name,
          icon: ug.icon || null,
          botPresent: false,
        };
      }).filter((entry) => isGuildAllowed(entry.id));

      result.sort((a, b) => (a.botPresent === b.botPresent ? 0 : a.botPresent ? -1 : 1));

      res.json(result);
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/:id', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const guild = client.guilds.get(guildId);

    let guildName = '';
    let guildIcon: string | null = null;
    let guildOwnerId: string | null = null;
    let channels: (APIChannel | Channel)[] = [];
    let roles: (APIRole | Role)[] = [];
    let emojis: {
      id: string;
      name?: string;
      animated?: boolean;
      url?: unknown; // this property likely is not sent by the API
    }[] = [];

    if (guild) {
      guildName = guild.name;
      guildIcon = guild.icon || null;
      guildOwnerId = guild.ownerId || null;
      channels = getGuildChannelCacheFallback(client, guild, guildId);
      roles = Array.from(guild.roles?.values?.() || []);
    } else {
      let fetched = false;
      try {
        const guildData = (await client.rest.get(Routes.guild(guildId))) as APIGuild;
        if (guildData?.id) {
          guildName = guildData.name;
          guildIcon = guildData.icon || null;
          guildOwnerId = guildData.owner_id || null;
          fetched = true;
        }
      } catch (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        err: any
      ) {
        log.warn(
          'API',
          `GET /guilds/${guildId} failed: ${err?.statusCode ?? err?.code ?? err?.message} - trying bot guild list fallback`,
        );
      }

      if (!fetched) {
        try {
          let after: string | undefined;
          let found: { name: string; icon?: string | null; owner_id?: string } | null = null;
          do {
            const url = Routes.currentUserGuilds() + (after ? `?after=${after}&limit=200` : '?limit=200');
            const page = (await client.rest.get(url)) as APIGuild[] | { guilds?: APIGuild[] };
            const arr = isArray(page) ? page : (page?.guilds ?? []);
            found = arr.find((g) => g.id === guildId) || null;
            if (found) break;
            if (arr.length === 200) after = arr[arr.length - 1]?.id;
            else break;
          } while (true);

          if (found) {
            guildName = found.name;
            guildIcon = found.icon ?? null;
            guildOwnerId = found.owner_id ?? null;
            fetched = true;
          }
        } catch (fallbackErr: unknown) {
          log.warn('API', `Guild ${guildId} fallback (bot guild list) failed: ${messageFromError(fallbackErr)}`);
        }
      }

      if (!fetched) {
        res.status(404).json({
          error: guildsT('guildNotFound'),
        });
        return;
      }
    }

    const cachedChannels = channels;
    try {
      const fetched = asArray(
        (await client.rest.get(Routes.guildChannels(guildId))) as APIChannel[] | Record<string, APIChannel>,
      );
      if (fetched.length > 0) channels = fetched;
    } catch {}
    const hasMissingNames = channels.length > 0 && channels.some((ch) => !ch?.name);
    if (channels.length === 0 || hasMissingNames) {
      channels = cachedChannels;
    }

    const cachedRoles = roles;
    try {
      const fetched = asArray(
        (await client.rest.get(Routes.guildRoles(guildId))) as APIRole[] | Record<string, APIRole>,
      );
      if (fetched.length > 0) roles = fetched;
    } catch {}
    if (roles.length === 0) {
      roles = cachedRoles;
    }
    if (emojis.length === 0) {
      try {
        const fetched = asArray<{
          id: string;
          name?: string;
          animated?: boolean;
        }>(await client.rest.get(Routes.guildEmojis(guildId)));
        if (fetched.length > 0) emojis = fetched;
      } catch {}
    }

    res.json({
      id: guildId,
      name: guildName,
      icon: guildIcon,
      ownerId: guildOwnerId,
      channels: channels
        .filter((ch) => ch.id && ch.name)
        .map((ch) => ({
          id: ch.id,
          name: ch.name,
          type: ch.type,
          parent_id: 'parent_id' in ch ? ch.parent_id : 'parentId' in ch ? ch.parentId : null,
          position: 'position' in ch ? ch.position : 0,
        })),
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
      })),
      emojis: emojis.map((emoji) => ({
        id: emoji.id,
        name: emoji.name,
        animated: !!emoji.animated,
        url: typeof emoji.url === 'string' ? emoji.url : null,
      })),
    });
  });

  router.get('/:id/settings', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const settings = await settingsCache.getOrCreate(req.params.id as string);
      res.json(settings);
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.patch('/:id/settings', requireGuildAccess, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;

    const updates = sanitizeUpdates(req.body);
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: guildsT('noValidFieldsToUpdate') });
      return;
    }

    // Deep-validate and sanitize all values
    const { valid, errors, sanitized } = validateSettingsUpdate(updates);
    if (!valid) {
      res.status(400).json({ error: guildsT('validationFailed'), details: errors });
      return;
    }

    if (sanitized.leveling && typeof sanitized.leveling === 'object') {
      const levelingPatch = sanitized.leveling as Record<string, unknown>;
      const mergedLeveling = normalizeLevelingSettings({
        ...(await settingsCache.get(guildId).catch(() => null))?.leveling,
        ...levelingPatch,
      });
      const conflict = await findLeaderboardVanityConflict(mergedLeveling.leaderboardVanity, guildId);
      if (conflict) {
        res.status(409).json({ error: 'That vanity URL is already taken' });
        return;
      }
      // Omit null vanity so the sparse unique index skips this doc. Replacing the whole
      // `leveling` subdoc clears a previous vanity — do not also $unset leveling.*
      // (Mongo rejects $set leveling + $unset leveling.leaderboardVanity as a path conflict).
      if (mergedLeveling.leaderboardVanity === null) {
        const { leaderboardVanity: _removed, ...levelingWithoutVanity } = mergedLeveling;
        void _removed;
        sanitized.leveling = levelingWithoutVanity as typeof sanitized.leveling;
      } else {
        sanitized.leveling = mergedLeveling;
      }
    }

    const prevBgImageURL =
      sanitized.welcomeMessage && typeof sanitized.welcomeMessage === 'object'
        ? (((await settingsCache.get(guildId).catch(() => null))?.welcomeMessage?.card?.bgImageURL as
            string | null | undefined) ?? null)
        : null;

    try {
      const updated = await GuildSettings.findOneAndUpdate(
        { guildId },
        { $set: sanitized },
        {
          returnDocument: 'after',
          upsert: true,
          runValidators: true,
        },
      ).lean();

      await syncGuildSettingsCache(guildId as string);

      broadcastSettingsUpdate(guildId as string);

      const nextWm = sanitized.welcomeMessage as { card?: { bgImageURL?: string | null } } | undefined;
      const nextBgImageURL = nextWm?.card?.bgImageURL ?? null;
      if (nextBgImageURL && nextBgImageURL !== prevBgImageURL && /^https?:\/\//i.test(nextBgImageURL)) {
        bgImageCache
          .download(nextBgImageURL)
          .catch((err) =>
            console.warn(`[welcome] bg prefetch failed for ${guildId} (${nextBgImageURL}): ${messageFromError(err)}`),
          );
      }

      res.json(updated);
    } catch (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      err: any
    ) {
      const fields = Object.keys(sanitized);
      if (err.name === 'ValidationError') {
        res
          .status(400)
          .json({ error: guildsT('validationErrorUpdating', { fields: fields.join(', ') }), details: err.message });
        return;
      }
      log.error('API', `Failed to update settings for ${guildId}: ${err.message}`);
      res.status(500).json({ error: guildsT('updateSettingsFailed') });
    }
  });

  router.post('/:id/ticket-setup', requireGuildAccess, requireBotOnline, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;

    try {
      const settings = (await GuildSettings.findOne({ guildId })) || (await GuildSettings.getOrCreate(guildId));
      const { channelId: existingChannelId } = req.body || {};

      const botId = client.user?.id;
      const everyoneRoleId = guildId;
      const overwrites: {
        id: string;
        type: number;
        allow: string;
        deny: string;
      }[] = [
        {
          id: everyoneRoleId,
          type: 0,
          allow: String(
            PermissionFlags.ViewChannel | PermissionFlags.AddReactions | PermissionFlags.ReadMessageHistory,
          ),
          deny: String(PermissionFlags.SendMessages),
        },
      ];
      if (botId) {
        overwrites.push({
          id: botId,
          type: 1,
          allow: String(
            PermissionFlags.ViewChannel |
              PermissionFlags.SendMessages |
              PermissionFlags.ManageMessages |
              PermissionFlags.ManageChannels |
              PermissionFlags.AddReactions |
              PermissionFlags.ReadMessageHistory |
              PermissionFlags.EmbedLinks,
          ),
          deny: '0',
        });
      }

      if (!settings.ticketCategoryId) {
        const categoryRes = (await client.rest.post(Routes.guildChannels(guildId), {
          body: { type: 4, name: 'Tickets' },
        })) as APIChannel;
        const categoryId = categoryRes?.id;
        if (!categoryId) {
          res.status(500).json({ error: guildsT('createTicketCategoryFailed') });
          return;
        }
        settings.ticketCategoryId = categoryId;
        await settings.save();
        await syncGuildSettingsCache(guildId);
      }

      let targetChannelId: string;
      let targetChannelName: string;

      if (existingChannelId) {
        try {
          const ch = await client.channels.fetch(existingChannelId);
          if (!ch) throw new Error('Channel not found');
          targetChannelId = ch.id;
          targetChannelName = ch.name ?? 'channel';
        } catch {
          res.status(400).json({ error: guildsT('specifiedChannelNotFound') });
          return;
        }
      } else {
        const channelRes = (await client.rest.post(Routes.guildChannels(guildId), {
          body: {
            type: 0,
            name: 'make-a-ticket',
            parent_id: settings.ticketCategoryId,
            topic: guildsT('ticketSetupTopic'),
            permission_overwrites: overwrites,
          },
        })) as APIChannel;
        targetChannelId = channelRes?.id;
        targetChannelName = channelRes?.name ?? 'make-a-ticket';
        if (!targetChannelId) {
          res.status(500).json({ error: guildsT('createTicketChannelFailed') });
          return;
        }
      }

      const emoji = settings.ticketEmoji || '\uD83C\uDFAB';
      const lang = normalizeLocale(settings.language);
      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'commands.admin.ticket.user.panelEmbed.title'))
        .setDescription(t(lang, 'commands.admin.ticket.user.panelEmbed.description', { emoji }))
        .setColor(0x5865f2)
        .setFooter({ text: t(lang, 'commands.admin.ticket.user.panelEmbed.footer') });

      const msgRes = (await client.rest.post(Routes.channelMessages(targetChannelId), {
        body: { embeds: [embed.toJSON()] },
      })) as APIMessage;
      const panelMsgId = msgRes?.id;
      if (!panelMsgId) {
        res.status(500).json({ error: guildsT('postTicketPanelMessageFailed') });
        return;
      }

      try {
        const encoded = encodeReactionForRoute(emoji);
        await client.rest.put(`${Routes.channelMessageReaction(targetChannelId, panelMsgId, encoded)}/@me`);
      } catch (reactErr) {
        console.warn(`[ticket-setup] Failed to add panel reaction for ${guildId}: ${messageFromError(reactErr)}`);
      }

      settings.ticketSetupChannelId = targetChannelId;
      settings.ticketSetupMessageId = panelMsgId;
      settings.markModified('ticketSetupChannelId');
      settings.markModified('ticketSetupMessageId');
      await settings.save();
      await syncGuildSettingsCache(guildId);
      broadcastSettingsUpdate(guildId);

      res.json({
        success: true,
        categoryId: settings.ticketCategoryId,
        channelId: targetChannelId,
        channelName: targetChannelName,
        messageId: panelMsgId,
      });
    } catch (err) {
      const errorMessage = `${messageFromError(err)}`;
      console.error(`[ticket-setup] Error for ${guildId}: ${errorMessage}`);
      res.status(500).json({ error: guildsT('ticketSetupFailed', { error: errorMessage }) });
    }
  });

  router.post('/:id/verification-setup', requireGuildAccess, requireBotOnline, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;

    try {
      const settings = (await GuildSettings.findOne({ guildId })) || (await GuildSettings.getOrCreate(guildId));

      // handle unmigrated data
      settings.verification ??= {
        // values assumed to be populated in later calls
      } as IVerification;

      const verification = settings.verification;

      const botId = client.user?.id;
      const everyoneRoleId = guildId;

      let verifiedRoleId = req.body?.verifiedRoleId || verification.verifiedRoleId;
      if (!verifiedRoleId) {
        try {
          const roleRes = (await client.rest.post(Routes.guildRoles(guildId), {
            body: { name: 'Verified', color: 0x2ecc71, mentionable: false },
          })) as APIRole;
          verifiedRoleId = roleRes?.id;
        } catch (err) {
          res.status(500).json({
            error: t('en', 'verification.errors.createVerifiedRoleFailed', { error: `${messageFromError(err)}` }),
          });
          return;
        }
      }
      verification.verifiedRoleId = verifiedRoleId;

      let categoryId = verification.categoryId;
      if (!categoryId) {
        try {
          const catRes = (await client.rest.post(Routes.guildChannels(guildId), {
            body: {
              type: 4,
              name: 'Verification',
              permission_overwrites: [
                { id: everyoneRoleId, type: 0, allow: '0', deny: String(PermissionFlags.ViewChannel) },
                ...(botId
                  ? [
                      {
                        id: botId,
                        type: 1,
                        allow: String(
                          PermissionFlags.ViewChannel |
                            PermissionFlags.SendMessages |
                            PermissionFlags.ManageChannels |
                            PermissionFlags.ManageMessages |
                            PermissionFlags.EmbedLinks |
                            PermissionFlags.AttachFiles |
                            PermissionFlags.ReadMessageHistory |
                            PermissionFlags.AddReactions,
                        ),
                        deny: '0',
                      },
                    ]
                  : []),
              ],
            },
          })) as APIChannel;
          categoryId = catRes?.id;
        } catch (err) {
          res
            .status(500)
            .json({ error: guildsT('createVerificationCategoryFailed', { error: `${messageFromError(err)}` }) });
          return;
        }
      }
      verification.categoryId = categoryId;

      let panelChannelId: string;
      try {
        const chRes = (await client.rest.post(Routes.guildChannels(guildId), {
          body: {
            type: 0,
            name: 'verify-here',
            parent_id: categoryId,
            topic: guildsT('verificationSetupTopic'),
            permission_overwrites: [
              {
                id: everyoneRoleId,
                type: 0,
                allow: String(
                  PermissionFlags.ViewChannel | PermissionFlags.ReadMessageHistory | PermissionFlags.AddReactions,
                ),
                deny: String(PermissionFlags.SendMessages),
              },
              ...(botId
                ? [
                    {
                      id: botId,
                      type: 1,
                      allow: String(
                        PermissionFlags.ViewChannel |
                          PermissionFlags.SendMessages |
                          PermissionFlags.ManageMessages |
                          PermissionFlags.EmbedLinks |
                          PermissionFlags.AttachFiles |
                          PermissionFlags.ReadMessageHistory |
                          PermissionFlags.AddReactions,
                      ),
                      deny: '0',
                    },
                  ]
                : []),
              { id: verifiedRoleId, type: 0, allow: '0', deny: String(PermissionFlags.ViewChannel) },
            ],
          },
        })) as APIChannel;
        panelChannelId = chRes?.id;
      } catch (err) {
        res
          .status(500)
          .json({ error: guildsT('createVerificationChannelFailed', { error: `${messageFromError(err)}` }) });
        return;
      }
      verification.panelChannelId = panelChannelId;

      const lang = normalizeLocale(settings.language);
      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'verification.panel.title'))
        .setDescription(t(lang, 'verification.panel.description'))
        .setColor(0x5865f2)
        .setFooter({ text: t(lang, 'verification.panel.footer') })
        .setTimestamp(new Date());

      const msgRes = (await client.rest.post(Routes.channelMessages(panelChannelId), {
        body: { embeds: [embed.toJSON()] },
      })) as APIMessage;
      const panelMessageId = msgRes?.id;

      try {
        const checkEncoded = encodeReactionForRoute('✅');
        await client.rest.put(`${Routes.channelMessageReaction(panelChannelId, panelMessageId, checkEncoded)}/@me`);
      } catch (err) {
        console.error(`[verification-setup] Failed to add reaction:`, err);
      }

      verification.panelMessageId = panelMessageId;
      verification.enabled = true;

      settings.markModified('verification');
      await settings.save();
      await syncGuildSettingsCache(guildId);
      broadcastSettingsUpdate(guildId);

      res.json({
        success: true,
        categoryId,
        panelChannelId,
        panelMessageId,
        verifiedRoleId,
      });
    } catch (err) {
      const errorMessage = `${messageFromError(err)}`;
      console.error(`[verification-setup] Error for ${guildId}: ${errorMessage}`);
      res.status(500).json({ error: guildsT('verificationSetupFailed', { error: errorMessage }) });
    }
  });

  router.post('/:id/reaction-roles/panels', requireGuildAccess, requireBotOnline, async (req: AuthRequest, res) => {
    const guildId = req.params.id as string;
    const { channelId, title, description, plainText } = req.body || {};
    if (!channelId || typeof channelId !== 'string') {
      res.status(400).json({ error: guildsT('channelIdRequired') });
      return;
    }
    try {
      const panelTitle = title && String(title).trim() ? String(title).trim() : guildsT('reactionRolesDefaultTitle');
      const panelDescription =
        description && String(description).trim()
          ? String(description).trim()
          : guildsT('reactionRolesDefaultDescription');
      const plainTextEnabled = plainText === true;
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(panelTitle)
        .setDescription(panelDescription)
        .setTimestamp(new Date());

      const msgRes = (await client.rest.post(Routes.channelMessages(channelId), {
        body: {
          ...(plainTextEnabled ? { content: panelDescription } : {}),
          embeds: [embed.toJSON()],
        },
      })) as APIMessage;
      const messageId = msgRes?.id;
      if (!messageId) {
        res.status(500).json({ error: guildsT('postReactionRolePanelFailed') });
        return;
      }

      const settings = (await GuildSettings.findOne({ guildId })) || (await GuildSettings.getOrCreate(guildId));
      const panels = settings.reactionRoles || [];
      const exists = panels.some((p) => p.messageId === messageId);
      if (!exists) {
        panels.push({
          messageId,
          channelId,
          title: title && String(title).trim() ? String(title).trim() : null,
          description: description && String(description).trim() ? String(description).trim() : null,
          plainText: plainTextEnabled,
          roles: [],
        });
        settings.reactionRoles = panels;
        settings.markModified('reactionRoles');
        await settings.save();
        await syncGuildSettingsCache(guildId);
        broadcastSettingsUpdate(guildId);
      }

      res.json({ messageId, channelId, plainText: plainTextEnabled });
    } catch (err) {
      console.error(`[reaction-roles] Create panel for ${guildId}: ${messageFromError(err)}`);
      res.status(500).json({ error: guildsT('createReactionRolePanelFailed') });
    }
  });

  router.post(
    '/:id/reaction-roles/panels/:messageId/mappings',
    requireGuildAccess,
    requireBotOnline,
    async (req: AuthRequest, res) => {
      const guildId = req.params.id as string;
      const messageId = req.params.messageId as string;
      const { emoji, roleId, removeRoleId } = req.body || {};
      if (!emoji || !roleId) {
        res.status(400).json({ error: guildsT('emojiAndRoleIdRequired') });
        return;
      }
      try {
        const settings = await GuildSettings.findOne({ guildId });
        if (!settings) {
          res.status(404).json({ error: guildsT('guildSettingsNotFound') });
          return;
        }
        const panels = settings.reactionRoles || [];
        const panel = panels.find((p) => p.messageId === messageId);
        if (!panel) {
          res.status(404).json({ error: guildsT('reactionRolePanelNotFound') });
          return;
        }
        if (panel.roles.length >= 20) {
          res.status(400).json({ error: guildsT('reactionRolePanelMaxMappings') });
          return;
        }
        const emojiRaw = String(emoji).trim();
        let normalized = emojiRaw;
        const mentionMatch = /^<a?:(\w+):(\d+)>$/.exec(normalized);
        if (mentionMatch) {
          normalized = `${mentionMatch[1]}:${mentionMatch[2]}`;
        } else {
          const colonMatch = /^a?:(\w+):(\d+)$/.exec(normalized);
          if (colonMatch) {
            normalized = `${colonMatch[1]}:${colonMatch[2]}`;
          } else {
            normalized = normalized.replace(/[\uFE00-\uFE0F\u200D]/g, '').trim();
          }
        }

        let emojiForReaction = emojiRaw;
        const looksLikeCustomEmojiInput = /^<a?:[\w]+:\d+>$/.test(emojiRaw) || /^(a:)?[\w]+:\d+$/.test(emojiRaw);
        if (looksLikeCustomEmojiInput) {
          try {
            const resolved = await client.resolveEmoji?.(emojiRaw, guildId);
            if (typeof resolved === 'string' && resolved.trim()) emojiForReaction = resolved.trim();
          } catch {}
        }
        if (panel.roles.some((r) => r.emoji === normalized || r.emoji === emojiRaw)) {
          res.status(400).json({ error: guildsT('reactionRoleEmojiAlreadyMapped') });
          return;
        }

        try {
          const channel = await client.channels.fetch(panel.channelId);
          if (isTextChannel(channel)) {
            const targetMessage = await channel.messages.fetch(messageId);
            await targetMessage.react(emojiForReaction);
          }
        } catch (reactErr) {
          res.status(400).json({
            error: guildsT('addReactionFailed', { error: messageFromError(reactErr, guildsT('invalidEmoji')) }),
          });
          return;
        }

        panel.roles.push({ emoji: normalized, roleId, removeRoleId: removeRoleId || null });
        settings.markModified('reactionRoles');
        await settings.save();
        await syncGuildSettingsCache(guildId);
        broadcastSettingsUpdate(guildId);

        res.json({ emoji: normalized, roleId, removeRoleId: removeRoleId || null });
      } catch (err) {
        console.error(`[reaction-roles] Add mapping for ${guildId}: ${messageFromError(err)}`);
        res.status(500).json({ error: guildsT('addReactionRoleMappingFailed') });
      }
    },
  );

  router.patch(
    '/:id/reaction-roles/panels/:messageId',
    requireGuildAccess,
    requireBotOnline,
    async (req: AuthRequest, res) => {
      const guildId = req.params.id as string;
      const messageId = req.params.messageId as string;
      const { title, description, plainText } = req.body || {};
      try {
        const settings = await GuildSettings.findOne({ guildId });
        if (!settings) {
          res.status(404).json({ error: guildsT('guildSettingsNotFound') });
          return;
        }
        const panels = settings.reactionRoles || [];
        const panel = panels.find((p) => p.messageId === messageId);
        if (!panel) {
          res.status(404).json({ error: guildsT('reactionRolePanelNotFound') });
          return;
        }

        const panelTitle =
          title !== null && title !== undefined && String(title).trim()
            ? String(title).trim()
            : guildsT('reactionRolesDefaultTitle');
        const panelDescription =
          description !== null && description !== undefined && String(description).trim()
            ? String(description).trim()
            : guildsT('reactionRolesDefaultDescription');
        const plainTextEnabled = typeof plainText === 'boolean' ? plainText : panel.plainText === true;
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(panelTitle)
          .setDescription(panelDescription)
          .setTimestamp(new Date());

        await client.rest.patch(Routes.channelMessage(panel.channelId, messageId), {
          body: {
            content: plainTextEnabled ? panelDescription : null,
            embeds: [embed.toJSON()],
          },
        });

        panel.title = title !== null && title !== undefined && String(title).trim() ? String(title).trim() : null;
        panel.description =
          description !== null && description !== undefined && String(description).trim()
            ? String(description).trim()
            : null;
        panel.plainText = plainTextEnabled;
        settings.markModified('reactionRoles');
        await settings.save();
        await syncGuildSettingsCache(guildId);
        broadcastSettingsUpdate(guildId);

        res.json({ success: true, title: panel.title, description: panel.description, plainText: panel.plainText });
      } catch (err) {
        console.error(`[reaction-roles] Edit panel for ${guildId}: ${messageFromError(err)}`);
        res.status(500).json({ error: guildsT('editReactionRolePanelFailed') });
      }
    },
  );

  router.post('/:id/upload-bg', requireGuildAccess, requireBotOnline, async (req: AuthRequest, res) => {
    try {
      const { image } = req.body;
      if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
        res.status(400).json({ error: guildsT('invalidImageData') });
        return;
      }

      const matches = image.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
      if (!matches || !('1' in matches) || !('2' in matches)) {
        res.status(400).json({ error: guildsT('unsupportedImageFormat') });
        return;
      }

      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const buffer = Buffer.from(matches[2], 'base64');

      if (buffer.length > 4 * 1024 * 1024) {
        res.status(400).json({ error: guildsT('imageTooLarge') });
        return;
      }

      const fs = await import('fs');
      const path = await import('path');
      const guildId = req.params.id as string;

      if (!/^\d{17,20}$/.test(guildId)) {
        res.status(400).json({ error: guildsT('invalidGuildIdFormat') });
        return;
      }

      const uploadsDir = path.join(uploadsRoot(), guildId);
      fs.mkdirSync(uploadsDir, { recursive: true });

      try {
        const existing = fs.readdirSync(uploadsDir).filter((f: string) => f.startsWith('bg-'));
        for (const old of existing) {
          try {
            fs.unlinkSync(path.join(uploadsDir, old));
          } catch {}
        }
      } catch {}

      const filename = `bg-${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), buffer);

      const url = `/uploads/${guildId}/${filename}`;
      res.json({ url });
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.post('/:id/send-embed', requireGuildAccess, requireBotOnline, async (req: AuthRequest, res) => {
    try {
      const guildId = req.params.id as string;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sendAs = body.sendAs === 'webhook' ? 'webhook' : 'bot';
      const content = typeof body.content === 'string' ? body.content : null;
      const webhookName = typeof body.webhookName === 'string' ? body.webhookName : null;

      const validated = validateEmbedPayload(body.embed);
      if (!validated.ok) {
        res.status(400).json({ error: validated.error });
        return;
      }

      if (sendAs === 'bot') {
        const channelId = typeof body.channelId === 'string' ? body.channelId : null;
        if (!channelId || !/^\d{17,20}$/.test(channelId)) {
          res.status(400).json({ error: 'A valid channelId is required' });
          return;
        }

        const channel = client.channels.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
        if (!channel) {
          res.status(400).json({ error: 'Channel not found' });
          return;
        }
        if (!isGuildChannel(channel)) {
          res.status(400).json({ error: 'Channel is not guild channel' });
          return;
        }

        const channelGuildId = getChannelGuildId(channel);
        if (channelGuildId !== guildId) {
          res.status(400).json({ error: 'Channel not found in this server' });
          return;
        }

        await sendGuildEmbedViaBot(client, channelId, validated.payload, content);
        res.json({ success: true, sendAs: 'bot', channelId });
        return;
      }

      const target = parseWebhookTarget({
        webhookUrl: typeof body.webhookUrl === 'string' ? body.webhookUrl : null,
        webhookId: typeof body.webhookId === 'string' ? body.webhookId : null,
        webhookToken: typeof body.webhookToken === 'string' ? body.webhookToken : null,
      });
      if (!target) {
        res.status(400).json({
          error:
            'Provide a Fluxer webhook URL (https://your-fluxer-api.example/webhooks/<id>/<token>) or webhookId + webhookToken',
        });
        return;
      }

      await sendGuildEmbedViaWebhook(client, target.id, target.token, validated.payload, {
        content,
        username: webhookName,
      });
      res.json({ success: true, sendAs: 'webhook' });
    } catch (err) {
      res.status(400).json({
        error: messageFromError(err, t('en', 'auditCatalog.api.errors.internalServer')),
      });
    }
  });

  router.get('/:id/tickets', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const Ticket = (await import('../../models/Ticket')).default;
      const rawStatus = req.query.status;
      const status: 'open' | 'closed' = rawStatus === 'open' || rawStatus === 'closed' ? rawStatus : 'open';
      const tickets = await Ticket.find({ guildId: req.params.id, status }).sort({ createdAt: -1 }).limit(50).lean();
      res.json(tickets);
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.post('/:id/tickets/:ticketId/claim', requireGuildAccess, requireBotOnline, async (req: AuthRequest, res) => {
    try {
      const Ticket = (await import('../../models/Ticket')).default;
      const ticket = await Ticket.findOne({ _id: req.params.ticketId, guildId: req.params.id });
      if (!ticket) {
        res.status(404).json({ error: guildsT('ticketNotFound') });
        return;
      }
      if (ticket.claimedBy) {
        res.status(400).json({ error: guildsT('ticketAlreadyClaimedBy', { userId: ticket.claimedBy }) });
        return;
      }
      ticket.claimedBy = req.userId ?? null;
      ticket.claimedAt = new Date();
      await ticket.save();

      try {
        const channel = client.channels.get(ticket.channelId);
        if (channel && isTextChannel(channel)) {
          await channel.send({
            embeds: [
              {
                title: guildsT('ticketClaimedTitle', { ticketNumber: ticket.ticketNumber }),
                description: guildsT('ticketClaimedDescription', { userId: req.userId! }),
                color: 0x2ecc71,
              },
            ],
          });
        }
      } catch {}

      res.json(ticket);
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.post('/:id/tickets/:ticketId/close', requireGuildAccess, requireBotOnline, async (req: AuthRequest, res) => {
    try {
      const Ticket = (await import('../../models/Ticket')).default;
      const ticket = await Ticket.findOne({ _id: req.params.ticketId, guildId: req.params.id, status: 'open' });
      if (!ticket) {
        res.status(404).json({ error: guildsT('openTicketNotFound') });
        return;
      }

      const reason = (req.body?.reason as string) || guildsT('ticketClosedFromDashboard');

      ticket.status = 'closed';
      ticket.closedBy = req.userId ?? null;
      ticket.closedAt = new Date();
      await ticket.save();

      try {
        const channel = client.channels.get(ticket.channelId);
        if (channel && isGuildTextChannel(channel)) {
          const lang = normalizeLocale((await settingsCache.get(req.params.id as string).catch(() => null))?.language);
          const embed = new EmbedBuilder()
            .setTitle(
              t(lang, 'auditCatalog.api.routes.guilds.l855_setTitle', {
                // TODO: revisit role hierarchy handling for this route.
                '(ticket as any).ticketNumber': ticket.ticketNumber,
              }),
            )
            .setDescription(t(lang, 'auditCatalog.api.routes.guilds.l856_setDescription', { 'req.userId': req.userId }))
            .setColor(0xed4245)
            .addFields({ name: t(lang, 'commands.moderation.warn.dmFieldReason'), value: reason, inline: false });

          if (ticket.claimedBy) {
            embed.addFields({
              name: t(lang, 'commands.admin.ticket.user.closeEmbed.claimedByField'),
              value: `<@${ticket.claimedBy}>`,
              inline: true,
            });
          }

          await channel.send({ embeds: [embed] });
          setTimeout(() => channel.delete().catch(() => {}), 5000);
        }
      } catch {}

      try {
        const guildSettings = await settingsCache.get(req.params.id as string);
        const lang = normalizeLocale(guildSettings?.language);
        const logChannelId = guildSettings?.ticketLogChannelId;
        if (logChannelId) {
          const logChannel = client.channels.get(logChannelId);
          if (logChannel) {
            const transcriptMessages = (ticket.transcript || []) as Array<{
              authorId: string;
              authorName: string;
              avatarURL?: string | null;
              content: string;
              attachments?: Array<{ url: string; name: string }>;
              timestamp: Date | string;
            }>;

            const logEmbed = new EmbedBuilder()
              .setTitle(
                t(lang, 'auditCatalog.api.routes.guilds.l882_setTitle', {
                  // TODO: revisit role hierarchy handling for this route.
                  '(ticket as any).ticketNumber': ticket.ticketNumber,
                }),
              )
              .setColor(0xed4245)
              .addFields(
                {
                  name: t(lang, 'commands.admin.ticket.user.logEmbed.openedByField'),
                  value: `<@${ticket.openedBy}>`,
                  inline: true,
                },
                {
                  name: t(lang, 'commands.admin.ticket.user.logEmbed.closedByField'),
                  value: t(lang, 'auditCatalog.api.routes.guilds.l886_addFields_value', { 'req.userId': req.userId }),
                  inline: true,
                },
              );
            if (ticket.claimedBy) {
              logEmbed.addFields({
                name: t(lang, 'commands.admin.ticket.user.logEmbed.claimedByField'),
                value: `<@${ticket.claimedBy}>`,
                inline: true,
              });
            }
            logEmbed.addFields({
              name: t(lang, 'commands.moderation.warn.dmFieldReason'),
              value: reason,
              inline: false,
            });

            if (ticket.subject) {
              logEmbed.addFields({
                name: t(lang, 'commands.admin.ticket.user.logEmbed.subjectField'),
                value: ticket.subject,
                inline: false,
              });
            }

            logEmbed
              .addFields({
                name: t(lang, 'commands.admin.ticket.user.logEmbed.messagesField'),
                value: String(transcriptMessages.length),
                inline: true,
              })
              .setTimestamp(new Date());

            const sendOpts: MessageSendOptions = { embeds: [logEmbed] };

            if (transcriptMessages.length > 0) {
              try {
                const guild = client.guilds.get(req.params.id as string);

                const nameCache = new Map<string, string>();
                for (const m of transcriptMessages) nameCache.set(m.authorId, m.authorName);

                const resolveName = async (id: string): Promise<string> => {
                  if (nameCache.has(id)) return nameCache.get(id)!;
                  try {
                    const u = await client.users.fetch(id);
                    const name = u.username || id;
                    nameCache.set(id, name);
                    return name;
                  } catch {
                    return id;
                  }
                };

                const openedByName = await resolveName(ticket.openedBy);
                const closedByName = await resolveName(req.userId!);
                const claimedByName = ticket.claimedBy ? await resolveName(ticket.claimedBy) : null;

                const html = await generateTranscriptHtml(
                  {
                    guildName: guild?.name || (req.params.id as string),
                    ticketNumber: ticket.ticketNumber,
                    openedBy: openedByName,
                    claimedBy: claimedByName,
                    closedBy: `${closedByName} (dashboard)`,
                    subject: ticket.subject,
                    createdAt: ticket.createdAt,
                    closedAt: new Date(),
                    messages: transcriptMessages,
                  },
                  client.rest,
                );
                sendOpts.files = [
                  {
                    name: `transcript-${ticket.ticketNumber}.html`,
                    data: Buffer.from(html, 'utf-8'),
                  },
                ];
              } catch (err) {
                console.error(`[ticket] Failed to generate transcript: ${messageFromError(err)}`);
              }
            }

            if (isSendCapable(logChannel)) {
              await sendMessage(logChannel, sendOpts);
            }
          }
        }
      } catch {}

      const openedByUserId = ticket.openedBy;
      if (openedByUserId) {
        try {
          const transcriptMessages = ticket.transcript || [];
          const guild = client.guilds.get(req.params.id as string);
          const lang = normalizeLocale((await settingsCache.get(req.params.id as string).catch(() => null))?.language);
          const userEmbed = new EmbedBuilder()
            .setTitle(
              t(lang, 'auditCatalog.api.routes.guilds.l958_setTitle', {
                // TODO: revisit role hierarchy handling for this route.
                '(ticket as any).ticketNumber': ticket.ticketNumber,
              }),
            )
            .setDescription(
              t(lang, 'auditCatalog.api.routes.guilds.l959_setDescription', {
                'guild?.name || req.params.id': guild?.name || String(req.params.id),
                'req.userId': req.userId,
              }),
            )
            .setColor(0xed4245)
            .addFields({ name: t(lang, 'commands.moderation.warn.dmFieldReason'), value: reason, inline: false })
            .setTimestamp(new Date());
          const userSendOpts: MessageSendOptions = { embeds: [userEmbed] };
          if (transcriptMessages.length > 0) {
            try {
              const nameCache = new Map<string, string>();
              for (const m of transcriptMessages) nameCache.set(m.authorId, m.authorName);
              const resolveName = async (id: string): Promise<string> => {
                if (nameCache.has(id)) return nameCache.get(id)!;
                try {
                  const u = await client.users.fetch(id);
                  const name = u.username || id;
                  nameCache.set(id, name);
                  return name;
                } catch {
                  return id;
                }
              };
              const openedByName = await resolveName(openedByUserId);
              const closedByName = await resolveName(req.userId!);
              const claimedByName = ticket.claimedBy ? await resolveName(ticket.claimedBy) : null;
              const html = await generateTranscriptHtml(
                {
                  guildName: guild?.name || (req.params.id as string),
                  ticketNumber: ticket.ticketNumber,
                  openedBy: openedByName,
                  claimedBy: claimedByName,
                  closedBy: `${closedByName} (dashboard)`,
                  subject: ticket.subject,
                  createdAt: ticket.createdAt,
                  closedAt: new Date(),
                  messages: transcriptMessages,
                },
                client.rest,
              );
              userSendOpts.files = [
                { name: `transcript-${ticket.ticketNumber}.html`, data: Buffer.from(html, 'utf-8') },
              ];
            } catch (err) {
              console.error(`[ticket] Failed to generate transcript for DM: ${messageFromError(err)}`);
            }
          }
          const opener = await client.users.fetch(openedByUserId).catch(() => null);
          if (opener) await sendMessage(opener, userSendOpts);
        } catch {}
      }

      res.json({
        _id: ticket._id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        closedBy: ticket.closedBy,
        closedAt: ticket.closedAt,
      });
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.post('/:id/rss/test', requireGuildAccess, requireBotOnline, async (req: AuthRequest, res) => {
    try {
      const guildId = req.params.id as string;
      const body: Record<string, unknown> = req.body ?? {};
      const sourceType = body.sourceType === 'rsshub' ? 'rsshub' : 'rss';
      const url = typeof body.url === 'string' ? body.url : null;
      const route = typeof body.route === 'string' ? body.route : null;

      if (sourceType === 'rss' && !url) {
        res.status(400).json({ error: guildsT('rssUrlRequired') });
        return;
      }

      if (sourceType === 'rsshub' && !route) {
        res.status(400).json({ error: guildsT('rsshubRouteRequired') });
        return;
      }

      const parsed = await fetchFeed(
        {
          sourceType,
          url,
          route,
        },
        {
          timeoutMs: config.rss.fetchTimeoutMs,
          maxBodyBytes: config.rss.maxBodyBytes,
          rsshubBaseUrl: config.rss.rsshubBaseUrl,
          rsshubAccessKey: config.rss.rsshubAccessKey,
        },
      );

      res.json({
        guildId,
        feedUrl: parsed.feedUrl,
        title: parsed.title,
        link: parsed.link,
        description: parsed.description,
        itemCount: parsed.items.length,
        items: parsed.items.slice(0, 5).map((item) => ({
          key: item.key,
          title: item.title,
          link: item.link,
          publishedAt: item.publishedAt,
          author: item.author,
        })),
      });
    } catch (err) {
      res.status(400).json({ error: messageFromError(err, guildsT('fetchFeedFailed')) });
    }
  });

  router.get('/:id/rss/status', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const guildId = req.params.id as string;
      const settings = await settingsCache.getOrCreate(guildId);
      const rss = settings?.rss;
      const feeds = isArray(rss?.feeds) ? rss.feeds : [];

      if (feeds.length === 0) {
        res.json([]);
        return;
      }

      const feedIds = feeds
        .map((feed) => (typeof feed?.id === 'string' ? feed.id : null))
        .filter((id: string | null): id is string => !!id);

      const states = await RssFeedState.find({
        guildId,
        feedId: { $in: feedIds },
      }).lean();

      const stateByFeedId = new Map(states.map((state) => [state.feedId, state]));

      res.json(
        feeds.map((feed) => {
          const state = stateByFeedId.get(feed.id);
          return {
            feedId: feed.id,
            name: feed.name ?? null,
            channelId: feed.channelId,
            enabled: feed.enabled !== false,
            sourceType: feed.sourceType,
            lastCheckedAt: state?.lastCheckedAt ?? null,
            lastSuccessAt: state?.lastSuccessAt ?? null,
            lastError: state?.lastError ?? null,
            consecutiveFailures: state?.consecutiveFailures ?? 0,
            seenCount: isArray(state?.seenItemIds) ? state!.seenItemIds.length : 0,
          };
        }),
      );
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  // ─── Starboard leaderboard ───
  router.get('/:id/starboard/leaderboard', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const StarboardMessage = (await import('../../models/StarboardMessage')).default;
      const guildId = req.params.id as string;
      const rawBoardId =
        typeof req.query.boardId === 'string'
          ? req.query.boardId
          : typeof req.query.channelId === 'string'
            ? req.query.channelId
            : null;
      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10;
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;

      const match = { guildId, starCount: { $gt: 0 }, ...(rawBoardId ? { starboardChannelId: rawBoardId } : {}) };

      const entries = await StarboardMessage.find(match).sort({ starCount: -1 }).limit(limit).lean();

      res.json(entries);
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  // ─── Starboard stats ───
  router.get('/:id/starboard/stats', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const StarboardMessage = (await import('../../models/StarboardMessage')).default;
      const guildId = req.params.id as string;
      const rawBoardId =
        typeof req.query.boardId === 'string'
          ? req.query.boardId
          : typeof req.query.channelId === 'string'
            ? req.query.channelId
            : null;

      const match = { guildId, ...(rawBoardId ? { starboardChannelId: rawBoardId } : {}) };

      const totalEntries = await StarboardMessage.countDocuments(match);
      const postedCount = await StarboardMessage.countDocuments({ ...match, starboardMessageId: { $ne: null } });
      const totalStarsResult = await StarboardMessage.aggregate([
        { $match: { ...match } },
        { $group: { _id: null, total: { $sum: '$starCount' } } },
      ]);
      const totalStars = totalStarsResult[0]?.total ?? 0;

      const topUsers = await StarboardMessage.aggregate([
        { $match: { ...match, starCount: { $gt: 0 } } },
        { $group: { _id: '$authorId', totalStars: { $sum: '$starCount' }, messageCount: { $sum: 1 } } },
        { $sort: { totalStars: -1 } },
        { $limit: 5 },
      ]);

      const boardBreakdown = await StarboardMessage.aggregate([
        { $match: { guildId } },
        { $group: { _id: '$starboardChannelId', stars: { $sum: '$starCount' }, messages: { $sum: 1 } } },
        { $sort: { stars: -1 } },
      ]);

      res.json({ totalEntries, totalStars, postedCount, topUsers, boardBreakdown });
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/:id/leveling/leaderboard', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const LevelProfile = (await import('../../models/LevelProfile')).default;
      const guildId = req.params.id as string;
      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10;
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 25) : 10;
      const sort = req.query.period === 'weekly' ? 'weeklyXp' : req.query.period === 'monthly' ? 'monthlyXp' : 'xp';
      const top = await LevelProfile.getTop(guildId, limit, sort);
      const leveling = normalizeLevelingSettings((await settingsCache.get(guildId).catch(() => null))?.leveling);
      res.json(top.map((profile) => ({ ...profile, level: levelForXp(profile.xp, leveling.formula) })));
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.post('/:id/leveling/reset', requireGuildAccess, requireBotOnline, async (req: AuthRequest, res) => {
    try {
      const guildId = req.params.id as string;
      const settings = await settingsCache.get(guildId).catch(() => null);
      const { normalizeLevelingSettings } = await import('../../types/Leveling');
      const leveling = normalizeLevelingSettings(settings?.leveling);

      if (leveling.management.resetOwnerOnly) {
        const guild = client.guilds.get(guildId);
        const ownerId = guild?.ownerId;
        if (ownerId && req.userId !== ownerId) {
          res.status(403).json({ error: 'Only the server owner can reset XP' });
          return;
        }
      }

      const result = await LevelProfile.deleteMany({ guildId });
      res.json({ deleted: result.deletedCount ?? 0 });
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.post('/:id/leveling/test-levelup', requireGuildAccess, requireBotOnline, async (req: AuthRequest, res) => {
    try {
      const guildId = req.params.id as string;
      const channelId = typeof req.body?.channelId === 'string' ? req.body.channelId : null;
      if (!channelId) {
        res.status(400).json({ error: 'channelId required' });
        return;
      }

      const settings = await settingsCache.get(guildId).catch(() => null);
      const leveling = normalizeLevelingSettings(settings?.leveling);

      const guild = client.guilds.get(guildId);
      const channel = guild?.channels?.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
      if (!channel || !isTextChannel(channel)) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      const text = renderLevelUpMessage(leveling.levelUp.template, {
        userId: req.userId ?? '0',
        username: 'Test User',
        level: 5,
        xp: 1250,
        earnedRoleId: leveling.levelRoles[0]?.roleId ?? null,
        earnedRoleName: 'Example Role',
      });

      await channel.send({ content: `[Test] ${text}` });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  router.get('/:id/leveling/rank-card-preview', requireGuildAccess, async (req: AuthRequest, res) => {
    try {
      const settings = await settingsCache.get(req.params.id as string).catch(() => null);
      const leveling = normalizeLevelingSettings(settings?.leveling);
      const png = await generateRankCard({
        username: 'Preview User',
        avatarURL: null,
        level: 5,
        xp: 1250,
        rank: 3,
        formula: leveling.formula,
        settings: leveling.rankCard,
      });
      res.setHeader('Content-Type', 'image/png');
      res.send(png);
    } catch {
      res.status(500).json({ error: t('en', 'auditCatalog.api.errors.internalServer') });
    }
  });

  return router;
}
