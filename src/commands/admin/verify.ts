import { createHash } from 'crypto';
import { EmbedBuilder, PermissionFlags } from '@fluxerjs/core';
import type { Client, Guild, Message, TextChannel } from '@fluxerjs/core';
import { Routes } from '@fluxerjs/types';
import type { Command, IVerification } from '@/types';
import GuildSettings, { GuildSettingsDocument } from '@/models/GuildSettings';
import VerificationSessionModel from '@/models/VerificationSession';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import { generateCaptcha } from '@/utils/captchaCard';
import { t, normalizeLocale } from '@/i18n';
import { isInUnion } from '@/utils/isInUnion';
import { messageFromError } from '@/utils/messageFromError';
import { sendMessage } from '@/utils/sendMessage';
import { isGuildChannel } from '@/utils/isGuildChannel';

export interface VerificationSession {
  guildId: string;
  channelId: string;
  userId: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  panelChannelId: string;
  panelMessageId: string;
  expiresAt: number;
  timeout: ReturnType<typeof setTimeout>;
}

export const verificationSessions = new Map<string, VerificationSession>();

export function hashVerificationCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export async function persistVerificationSession(session: VerificationSession): Promise<void> {
  try {
    await VerificationSessionModel.findOneAndUpdate(
      { channelId: session.channelId },
      {
        $set: {
          guildId: session.guildId,
          channelId: session.channelId,
          userId: session.userId,
          panelChannelId: session.panelChannelId,
          panelMessageId: session.panelMessageId,
          codeHash: session.codeHash,
          attempts: session.attempts,
          maxAttempts: session.maxAttempts,
          expiresAt: new Date(session.expiresAt),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  } catch (err: unknown) {
    console.warn(`[verification] Failed to persist session ${session.channelId}: ${messageFromError(err)}`);
  }
}

export async function removeVerificationSession(channelId: string): Promise<void> {
  const session = verificationSessions.get(channelId);
  if (session) clearTimeout(session.timeout);
  verificationSessions.delete(channelId);

  try {
    await VerificationSessionModel.deleteOne({ channelId });
  } catch (err: unknown) {
    console.warn(`[verification] Failed to remove session ${channelId}: ${messageFromError(err)}`);
  }
}

async function deleteVerificationChannel(client: Client, channelId: string): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel && isGuildChannel(channel)) await channel.delete();
  } catch {}
}

async function removeVerificationPanelReaction(
  client: Client,
  session: Pick<VerificationSession, 'panelChannelId' | 'panelMessageId' | 'userId'>,
): Promise<void> {
  if (!session.panelChannelId || !session.panelMessageId) return;

  await client.rest
    .delete(`${Routes.channelMessageReaction(session.panelChannelId, session.panelMessageId, '✅')}/${session.userId}`)
    .catch(() => {});
}

export async function expireVerificationSession(
  client: Client,
  channelId: string,
  expectedExpiresAt?: number,
): Promise<void> {
  const session = verificationSessions.get(channelId);
  if (expectedExpiresAt !== undefined && (!session || session.expiresAt !== expectedExpiresAt)) return;

  await removeVerificationSession(channelId);
  if (session) await removeVerificationPanelReaction(client, session);
  await deleteVerificationChannel(client, channelId);
}

function scheduleVerificationExpiry(client: Client, session: VerificationSession): void {
  const delay = Math.max(0, session.expiresAt - Date.now());
  session.timeout = setTimeout(() => {
    void expireVerificationSession(client, session.channelId, session.expiresAt);
  }, delay);
  session.timeout.unref();
}

export async function registerVerificationSession(
  client: Client,
  options: {
    guildId: string;
    channelId: string;
    userId: string;
    code: string;
    maxAttempts: number;
    panelChannelId: string;
    panelMessageId: string;
    expiresAt: number;
  },
): Promise<void> {
  const previous = verificationSessions.get(options.channelId);
  if (previous) clearTimeout(previous.timeout);

  const { code, ...sessionOptions } = options;
  const session = {
    ...sessionOptions,
    codeHash: hashVerificationCode(code),
    attempts: 0,
  } as VerificationSession;

  verificationSessions.set(session.channelId, session);
  scheduleVerificationExpiry(client, session);
  await persistVerificationSession(session);
}

export async function restoreVerificationSessions(client: Client): Promise<void> {
  for (const session of verificationSessions.values()) clearTimeout(session.timeout);
  verificationSessions.clear();

  const now = new Date();
  const expired = await VerificationSessionModel.find({ expiresAt: { $lte: now } });
  for (const session of expired) {
    await removeVerificationPanelReaction(client, session);
    await deleteVerificationChannel(client, session.channelId);
    await VerificationSessionModel.deleteOne({ _id: session._id });
  }

  const pending = await VerificationSessionModel.find({ expiresAt: { $gt: now } });
  let restored = 0;
  for (const stored of pending) {
    const channel = await client.channels.fetch(stored.channelId).catch(() => null);
    if (!channel || !isGuildChannel(channel)) {
      await VerificationSessionModel.deleteOne({ _id: stored._id });
      continue;
    }

    const session = {
      guildId: stored.guildId,
      channelId: stored.channelId,
      userId: stored.userId,
      codeHash: stored.codeHash,
      attempts: stored.attempts,
      maxAttempts: stored.maxAttempts,
      panelChannelId: stored.panelChannelId,
      panelMessageId: stored.panelMessageId,
      expiresAt: stored.expiresAt.getTime(),
    } as VerificationSession;

    verificationSessions.set(session.channelId, session);
    scheduleVerificationExpiry(client, session);
    restored++;
  }

  if (expired.length > 0 || restored > 0) {
    console.log(`[verification] Cleaned ${expired.length} expired session(s), restored ${restored} pending session(s)`);
  }
}

async function embedReply(message: Message, description: string, title?: string): Promise<void> {
  const embed = new EmbedBuilder().setDescription(description).setColor(0x5865f2);
  if (title) embed.setTitle(title);
  await message.reply({ embeds: [embed] });
}

async function save(settings: GuildSettingsDocument, guildId: string): Promise<void> {
  settings.markModified('verification');
  await settings.save();
  settingsCache.invalidate(guildId);
}

async function setupVerification(
  message: Message,
  _args: string[],
  guild: Guild,
  settings: GuildSettingsDocument,
  client: Client,
  _prefix: string,
): Promise<void> {
  const lang = normalizeLocale(settings.language);
  const verification = settings.verification;
  const botId = client.user?.id;
  const everyoneRoleId = guild.id;

  let verifiedRoleId = verification.verifiedRoleId;
  if (!verifiedRoleId) {
    try {
      const role = await guild.createRole({
        name: 'Verified',
        color: 0x2ecc71,
      });
      verifiedRoleId = role.id;
      verification.verifiedRoleId = verifiedRoleId;
    } catch (err) {
      return embedReply(
        message,
        t(lang, 'verification.errors.createVerifiedRoleFailed', { error: `${messageFromError(err)}` }),
      );
    }
  }

  let categoryId = verification.categoryId;
  if (!categoryId) {
    try {
      const category = await guild.createChannel({
        type: 4,
        name: 'Verification',
        permissionOverwrites: [
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
      });
      categoryId = category.id;
      verification.categoryId = categoryId;
    } catch (err) {
      return embedReply(
        message,
        t(lang, 'verification.errors.createCategoryFailed', { error: `${messageFromError(err)}` }),
      );
    }
  }

  let panelChannelId = verification.panelChannelId;
  if (!panelChannelId) {
    try {
      const panelChannel = await guild.createChannel({
        type: 0,
        name: 'verify-here',
        parentId: categoryId,
        topic: 'React with ✅ to begin the verification process.',
        permissionOverwrites: [
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
      });
      panelChannelId = panelChannel.id;
      verification.panelChannelId = panelChannelId;
    } catch (err) {
      return embedReply(
        message,
        t(lang, 'verification.errors.createPanelChannelFailed', { error: `${messageFromError(err)}` }),
      );
    }
  }

  try {
    const panelEmbed = new EmbedBuilder()
      .setTitle(t(lang, 'verification.panel.title'))
      .setDescription(t(lang, 'verification.panel.description'))
      .setColor(0x5865f2)
      .setFooter({ text: t(lang, 'verification.panel.footer') });

    const channel = guild.channels?.get?.(panelChannelId) || (await client.channels.fetch(panelChannelId));
    if (!channel.isTextBased()) return embedReply(message, t(lang, 'verification.errors.serverOnly'));

    const panelMessage = await channel.send({ embeds: [panelEmbed] });
    await panelMessage.react('✅');

    verification.panelMessageId = panelMessage.id;
  } catch (err) {
    return embedReply(message, t(lang, 'verification.errors.postPanelFailed', { error: `${messageFromError(err)}` }));
  }

  verification.enabled = true;
  await save(settings, guild.id);

  const statusEmbed = new EmbedBuilder()
    .setTitle(t(lang, 'verification.setupComplete.title'))
    .setDescription(t(lang, 'verification.setupComplete.description', { panelChannelId, verifiedRoleId }))
    .setColor(0x2ecc71);

  await message.reply({ embeds: [statusEmbed] });
}

async function postPanel(
  message: Message,
  args: string[],
  guild: Guild,
  settings: GuildSettingsDocument,
  client: Client,
  prefix: string,
): Promise<void> {
  const lang = normalizeLocale(settings.language);
  const verification = settings.verification;

  const channelArg = args[0];
  let channelId = verification.panelChannelId;

  if (channelArg) {
    const parsed = channelArg.match(/^<#(\d{17,19})>$/)?.[1] ?? (/^\d{17,19}$/.test(channelArg) ? channelArg : null);
    if (parsed) channelId = parsed;
  }

  if (!channelId) {
    return embedReply(message, t(lang, 'verification.errors.missingPanelChannel', { prefix }));
  }

  try {
    const panelEmbed = new EmbedBuilder()
      .setTitle(t(lang, 'verification.panel.title'))
      .setDescription(t(lang, 'verification.panel.description'))
      .setColor(0x5865f2)
      .setFooter({ text: t(lang, 'verification.panel.footer') });

    const channel = guild.channels.get(channelId) || (await client.channels.fetch(channelId));
    if (!channel.isTextBased()) return embedReply(message, t(lang, 'verification.errors.serverOnly'));

    const panelMsg = await channel.send({ embeds: [panelEmbed] });
    await panelMsg.react('✅');

    verification.panelChannelId = channelId;
    verification.panelMessageId = panelMsg.id;
    await save(settings, guild.id);

    return embedReply(message, t(lang, 'verification.panelPosted', { channelId }));
  } catch (err) {
    return embedReply(
      message,
      t(lang, 'verification.errors.postPanelGenericFailed', { error: `${messageFromError(err)}` }),
    );
  }
}

async function setRole(
  message: Message,
  args: string[],
  guild: Guild,
  settings: GuildSettingsDocument,
  _client: Client,
  prefix: string,
): Promise<void> {
  const lang = normalizeLocale(settings.language);
  const roleArg = args[0];
  if (!roleArg) return embedReply(message, t(lang, 'verification.errors.usageRole', { prefix }));

  const roleId = roleArg.match(/^<@&(\d{17,19})>$/)?.[1] ?? (/^\d{17,19}$/.test(roleArg) ? roleArg : null);
  if (!roleId) return embedReply(message, t(lang, 'commands.generic.invalidRoleInput'));

  settings.verification.verifiedRoleId = roleId;
  await save(settings, guild.id);
  return embedReply(message, t(lang, 'verification.roleSetDone', { roleId }));
}

async function setCategory(
  message: Message,
  args: string[],
  guild: Guild,
  settings: GuildSettingsDocument,
  _client: Client,
  prefix: string,
): Promise<void> {
  const lang = normalizeLocale(settings.language);
  const catArg = args[0];
  if (!catArg) return embedReply(message, t(lang, 'verification.errors.usageCategory', { prefix }));

  const catId = /^\d{17,19}$/.test(catArg) ? catArg : null;
  if (!catId) return embedReply(message, t(lang, 'verification.errors.invalidCategory'));

  settings.verification.categoryId = catId;
  await save(settings, guild.id);
  return embedReply(message, t(lang, 'verification.categorySetDone', { categoryId: catId }));
}

async function setLog(
  message: Message,
  args: string[],
  guild: Guild,
  settings: GuildSettingsDocument,
  _client: Client,
  prefix: string,
): Promise<void> {
  const lang = normalizeLocale(settings.language);
  const channelArg = args[0];
  if (!channelArg) return embedReply(message, t(lang, 'verification.errors.usageLog', { prefix }));

  if (channelArg.toLowerCase() === 'clear') {
    settings.verification.logChannelId = null;
    await save(settings, guild.id);
    return embedReply(message, t(lang, 'verification.log.cleared'));
  }

  const channelId = channelArg.match(/^<#(\d{17,19})>$/)?.[1] ?? (/^\d{17,19}$/.test(channelArg) ? channelArg : null);
  if (!channelId) return embedReply(message, t(lang, 'commands.generic.invalidChannelInput'));

  settings.verification.logChannelId = channelId;
  await save(settings, guild.id);
  return embedReply(message, t(lang, 'verification.log.setDone', { channelId }));
}

async function showStatus(
  message: Message,
  _args: string[],
  _guild: Guild,
  settings: GuildSettingsDocument,
  _client: Client,
  _prefix: string,
): Promise<void> {
  const lang = normalizeLocale(settings.language);
  const v = settings.verification;

  const statusEmbed = new EmbedBuilder()
    .setTitle(t(lang, 'verification.status.title'))
    .setColor(0x5865f2)
    .setDescription(
      `**Enabled:** ${v.enabled ? t(lang, 'verification.status.enabledYes') : t(lang, 'verification.status.enabledNo')}\n` +
        `**Verified Role:** ${v.verifiedRoleId ? `<@&${v.verifiedRoleId}>` : t(lang, 'verification.status.notSet')}\n` +
        `**Category:** ${v.categoryId || t(lang, 'verification.status.notSet')}\n` +
        `**Panel Channel:** ${v.panelChannelId ? `<#${v.panelChannelId}>` : t(lang, 'verification.status.notSet')}\n` +
        `**Log Channel:** ${v.logChannelId ? `<#${v.logChannelId}>` : t(lang, 'verification.status.notSet')}\n` +
        `**${t(lang, 'verification.status.maxAttemptsLabel')}:** ${v.maxAttempts || 2}`,
    );

  await message.reply({ embeds: [statusEmbed] });
}

async function resetVerification(
  message: Message,
  _args: string[],
  guild: Guild,
  settings: GuildSettingsDocument,
  _client: Client,
  _prefix: string,
): Promise<void> {
  const lang = normalizeLocale(settings.language);
  settings.verification = {
    enabled: false,
    categoryId: null,
    verifiedRoleId: null,
    panelChannelId: null,
    panelMessageId: null,
    logChannelId: null,
    maxAttempts: 2,
  };
  await save(settings, guild.id);
  return embedReply(message, t(lang, 'verification.resetDone'));
}

async function testVerification(
  message: Message,
  _args: string[],
  guild: Guild,
  settings: GuildSettingsDocument,
  client: Client,
  prefix: string,
): Promise<void> {
  const lang = normalizeLocale(settings.language);
  const verification = settings.verification;

  if (!verification.categoryId) {
    return embedReply(message, t(lang, 'verification.errors.usageTestFirst', { prefix }));
  }

  const userId = message.author.id;
  const botId = client.user?.id;
  const everyoneRoleId = guild.id;

  let channel: TextChannel;
  try {
    const username = message.author.username || 'user';
    const safeName =
      username
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 16) || 'user';

    channel = (await guild.createChannel({
      type: 0,
      name: `verify-${safeName}`,
      parentId: verification.categoryId,
      permissionOverwrites: [
        { id: everyoneRoleId, type: 0, allow: '0', deny: String(PermissionFlags.ViewChannel) },
        {
          id: userId,
          type: 1,
          allow: String(
            PermissionFlags.ViewChannel | PermissionFlags.SendMessages | PermissionFlags.ReadMessageHistory,
          ),
          deny: '0',
        },
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
                    PermissionFlags.ReadMessageHistory,
                ),
                deny: '0',
              },
            ]
          : []),
      ],
    })) as TextChannel; /* cast used as `type: 0` is specified in options */
  } catch (err) {
    return embedReply(
      message,
      t(lang, 'verification.errors.createTestVerificationChannelFailed', { error: `${messageFromError(err)}` }),
    );
  }

  try {
    const { code, image } = await generateCaptcha();
    const maxAttempts = verification.maxAttempts || 2;

    const captchaEmbed = new EmbedBuilder()
      .setTitle(t(lang, 'verification.captcha.title'))
      .setDescription(t(lang, 'verification.captcha.description', { userId, maxAttempts }))
      .setColor(0x5865f2);

    await sendMessage(channel, {
      embeds: [captchaEmbed],
      files: [{ name: 'captcha.png', data: image }],
    });

    await registerVerificationSession(client, {
      guildId: guild.id,
      channelId: channel.id,
      userId,
      code,
      maxAttempts,
      panelChannelId: verification.panelChannelId || '',
      panelMessageId: verification.panelMessageId || '',
      expiresAt: Date.now() + 60_000,
    });

    return embedReply(message, t(lang, 'verification.testChannelCreated', { channelId: channel.id }));
  } catch (err) {
    try {
      await channel.delete();
    } catch {}
    return embedReply(
      message,
      t(lang, 'verification.errors.generateCaptchaFailed', { error: `${messageFromError(err)}` }),
    );
  }
}

function showHelp(message: Message, prefix: string, lang: string): Promise<void> {
  return embedReply(message, t(lang, 'verification.help.body', { prefix }), t(lang, 'verification.help.title'));
}

const SUBCOMMAND_LITERALS = ['setup', 'panel', 'role', 'category', 'log', 'status', 'reset', 'test'] as const;

const subcommands: Record<
  (typeof SUBCOMMAND_LITERALS)[number],
  (
    message: Message,
    args: string[],
    guild: Guild,
    settings: GuildSettingsDocument,
    client: Client,
    prefix: string,
  ) => Promise<void>
> = {
  setup: setupVerification,
  panel: postPanel,
  role: setRole,
  category: setCategory,
  log: setLog,
  status: showStatus,
  reset: resetVerification,
  test: testVerification,
};

const command: Command = {
  name: 'verify',
  description: [
    'Set up manual captcha verification for your server.',
    '',
    '**Subcommands:**',
    '`setup` - auto-create category, channel, role, and panel',
    '`panel [#channel]` - (re-)post the verification panel embed',
    '`role <@role>` - set the verified role',
    '`category <id>` - set the verification category',
    '`log <#channel>` - set a verification log channel',
    '`status` - show current verification config',
    '`reset` - disable and clear settings',
    '`test` - test verification with a temp channel',
  ].join('\n'),
  usage: '<subcommand> [options]',
  category: 'admin',
  permissions: ['ManageGuild'],
  cooldown: 5,

  async execute(message, args, client, prefix = '!') {
    let guild = message.guild;
    if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
    if (!guild) return void (await embedReply(message, t('en', 'commands.generic.serverOnly')));

    const sub = args[0]?.toLowerCase();

    let settings: GuildSettingsDocument | null = null;
    let lang = 'en';
    try {
      settings = await GuildSettings.getOrCreate(guild.id);

      // handle unmigrated data
      settings.verification ??= {
        // values assumed to be populated in later calls
      } as IVerification;

      lang = normalizeLocale(settings.language);
    } catch {
      return embedReply(message, t(lang, 'verification.errors.fetchFailed')).catch(() => {});
    }

    if (!isInUnion(sub, SUBCOMMAND_LITERALS) || !subcommands[sub]) return showHelp(message, prefix, lang);

    try {
      await subcommands[sub](message, args.slice(1), guild, settings, client, prefix);
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !verify (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !verify: ${messageFromError(error)}`);
        embedReply(message, t(lang, 'verification.errors.updateFailed')).catch(() => {});
      }
    }
  },
};

export default command;
