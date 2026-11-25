// za commen handler

import fs from 'fs';
import path from 'path';
import * as GlitchTip from '@sentry/node';
import { PermissionFlags, EmbedBuilder } from '@fluxerjs/core';
import type { GuildMember, Message } from '@fluxerjs/core';
import type { BotClient, Command, ICommandHandler } from '@/types';
import config from '@/config';
import settingsCache from '@/utils/settingsCache';
import isNetworkError from '@/utils/isNetworkError';
import statsService from '@/services/StatsService';
import UserSettings from '@/models/UserSettings';
import parseUserId from '@/utils/parseUserId';
import { isArray } from '@/utils/isArray';
import { sendUserDm } from '@/utils/sendUserDm';
import { ensureGuildRolesLoaded } from '@/utils/permissions';
import { isBlocked, isGuildBlocked, shouldSendTerminationNotice, terminationNotice } from '@/utils/serviceBlockCache';
import { t, normalizeLocale } from '@/i18n';
import { isInUnion } from '@/utils/isInUnion';
import { messageFromError } from '@/utils/messageFromError';
import activityService from '@/services/ActivityService';
import { isGuildAllowed } from '@/utils/accessControl';

const DEFAULT_PREFIXES = [config.prefix];
const MAX_CUSTOM_COMMANDS_PER_GUILD = 15;
const COOLDOWN_NOTICE_INTERVAL_MS = 10_000;

export default class CommandHandler implements ICommandHandler {
  commands = new Map<string, Command>();
  private cooldowns = new Map<string, number>();
  private cooldownNoticeAt = new Map<string, number>();
  private customCommandCooldowns = new Map<string, number>();
  prefix: string;

  constructor(public client: BotClient) {
    this.prefix = config.prefix;
  }

  async getPrefixes(guildId: string | null | undefined): Promise<string[]> {
    if (!guildId) {
      return DEFAULT_PREFIXES;
    }

    try {
      const settings = await settingsCache.get(guildId);

      if (settings && settings.prefixes && settings.prefixes.length > 0) {
        return settings.prefixes;
      }

      return DEFAULT_PREFIXES;
    } catch (error) {
      console.error('Error fetching prefixes:', error);
      return DEFAULT_PREFIXES;
    }
  }

  async loadCommands(): Promise<void> {
    const commandsPath = path.join(__dirname, '..', 'commands');

    if (!fs.existsSync(commandsPath)) {
      console.warn('Commands directory not found, creating...');
      fs.mkdirSync(commandsPath, { recursive: true });
      return;
    }

    const categories = fs
      .readdirSync(commandsPath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const category of categories) {
      const categoryPath = path.join(commandsPath, category);
      const commandFiles = fs
        .readdirSync(categoryPath)
        .filter((file) => (file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts'));

      for (const file of commandFiles) {
        try {
          const commandPath = path.join(categoryPath, file);
          const imported = require(commandPath);
          const command: Command = imported.default || imported;

          if (!command.name) {
            console.warn(`Command in ${file} is missing a name, skipping...`);
            continue;
          }

          this.commands.set(command.name, {
            ...command,
            category,
          });

          if (command.aliases && isArray(command.aliases)) {
            for (const alias of command.aliases) {
              this.commands.set(alias, {
                ...command,
                category,
                isAlias: true,
              });
            }
          }
        } catch (error: unknown) {
          console.error(`Error loading command ${file}:`, messageFromError(error));
        }
      }
    }
  }

  async handleMessage(message: Message): Promise<void> {
    if (message.author?.bot || !message.content) return;

    const guildId = message.guildId || message.guild?.id;
    const userId = message.author?.id;
    let locale = 'en';

    if (guildId) {
      try {
        const localeSettings = await settingsCache.get(guildId);
        locale = normalizeLocale(localeSettings?.language);
      } catch {}
    }

    let usedPrefix: string | null = null;

    if (userId) {
      try {
        const userPrefix = await UserSettings.getPrefix(userId);
        if (userPrefix && message.content.startsWith(userPrefix)) {
          usedPrefix = userPrefix;
        }
      } catch {}
    }

    if (!usedPrefix) {
      const prefixes = await this.getPrefixes(guildId);
      for (const prefix of prefixes) {
        if (message.content.startsWith(prefix)) {
          usedPrefix = prefix;
          break;
        }
      }
    }

    if (!usedPrefix) return;

    // private deployment: only the configured guild may use commands. the bot
    // also leaves other guilds, this is the belt-and-braces check.
    if (guildId && !isGuildAllowed(guildId)) return;

    // service termination (ToS section 7): terminated guilds/users get a refusal
    // instead of running the command. owner always bypasses.
    if (userId && userId !== config.ownerId && (await isBlocked({ guildId, userId }))) {
      if (shouldSendTerminationNotice(guildId, userId)) {
        const kind = guildId && (await isGuildBlocked(guildId)) ? 'guild' : 'user';
        await message.reply(terminationNotice(kind)).catch(() => {});
      }
      return;
    }

    const args = message.content.slice(usedPrefix.length).trim().split(/\s+/);
    const commandName = args.shift()?.toLowerCase();

    if (!commandName) return;

    let command = this.commands.get(commandName);
    if (command?.hidden && command?.ownerOnly && config.ownerId && message.author?.id !== config.ownerId) {
      command = undefined;
    }
    if (!command) {
      if (guildId) {
        try {
          const settings = await settingsCache.get(guildId);
          const lang = normalizeLocale(settings?.language);
          const customCommands = isArray(settings?.customCommands)
            ? settings.customCommands.slice(0, MAX_CUSTOM_COMMANDS_PER_GUILD)
            : [];
          const customCmd = customCommands.find((c) => c.name === commandName);

          if (customCmd && customCmd.enabled !== false) {
            const disabled = settings?.disabledCommands ?? [];
            if (disabled.includes(commandName) || disabled.includes('customcommand')) {
              return;
            }

            const channelId = message.channelId || message.channel?.id;

            if (settings?.blacklistedChannels && isInUnion(channelId, settings.blacklistedChannels)) {
              const member = await this.getMember(message);
              const memberRoleIds = member?.roles?.roleIds ?? [];

              const isStaff = settings.staffRoleId && memberRoleIds.includes(settings.staffRoleId);
              const isAdmin =
                member?.permissions?.has(PermissionFlags.Administrator) ||
                member?.permissions?.has(PermissionFlags.ManageGuild);

              if (!isStaff && !isAdmin) {
                return;
              }
            }

            if (isArray(customCmd.allowedChannelIds) && customCmd.allowedChannelIds.length > 0) {
              if (!channelId || !customCmd.allowedChannelIds.includes(channelId)) {
                return;
              }
            }

            const needsRoleGate = isArray(customCmd.requiredRoleIds) && customCmd.requiredRoleIds.length > 0;
            const needsPermissionGate =
              typeof customCmd.requiredPermission === 'string' && customCmd.requiredPermission.length > 0;

            if (needsRoleGate || needsPermissionGate) {
              const member = await this.getMember(message, { refresh: needsPermissionGate });
              if (!member) return;

              const memberRoleIds = member?.roles?.roleIds ?? [];

              if (needsRoleGate) {
                const hasRole = customCmd.requiredRoleIds.some((roleId) => memberRoleIds.includes(roleId));
                if (!hasRole) {
                  return;
                }
              }

              if (needsPermissionGate) {
                const permissionName = customCmd.requiredPermission;
                if (typeof permissionName !== 'string') {
                  return;
                }

                const flag = (PermissionFlags as unknown as Record<string, bigint>)[permissionName];
                if (!flag || !member?.permissions?.has(flag)) {
                  return;
                }
              }
            }

            const cooldownSeconds =
              typeof customCmd.cooldownSeconds === 'number'
                ? Math.max(0, Math.min(3600, Math.floor(customCmd.cooldownSeconds)))
                : 0;

            if (cooldownSeconds > 0 && message.author?.id) {
              const customCooldown = this.checkCustomCommandCooldown(
                message.author.id,
                guildId,
                customCmd.name,
                cooldownSeconds,
              );

              if (!customCooldown.ready) {
                await message
                  .reply(
                    t(lang, 'auditCatalog.handlers.CommandHandler.l220_reply', {
                      'customCooldown.remaining': customCooldown.remaining,
                      'customCmd.name': customCmd.name,
                    }),
                  )
                  .catch(() => {});
                return;
              }
            }

            const ROLE_ACTIONS = ['toggleRole', 'addRole', 'removeRole'];
            const VALID_ACTIONS = [...ROLE_ACTIONS, 'sendDM', 'reply'];
            const actionType = VALID_ACTIONS.includes(customCmd.actionType as string)
              ? (customCmd.actionType as string)
              : 'reply';
            const authorMention = `<@${message.author.id}>`;
            let targetMention = authorMention;
            let roleMention = 'configured role';
            let actionWord = 'sent';

            if (ROLE_ACTIONS.includes(actionType)) {
              let guild = message.guild;
              if (!guild && guildId) {
                guild = await this.client.guilds.fetch(guildId).catch(() => null);
              }

              if (!guild) {
                await message.reply(t(lang, 'auditCatalog.handlers.CommandHandler.l239_reply')).catch(() => {});
                return;
              }

              const targetRoleId =
                typeof customCmd.targetRoleId === 'string' && customCmd.targetRoleId.length > 0
                  ? customCmd.targetRoleId
                  : null;

              if (!targetRoleId) {
                await message
                  .reply(
                    t(lang, 'auditCatalog.handlers.CommandHandler.l248_reply', { 'customCmd.name': customCmd.name }),
                  )
                  .catch(() => {});
                return;
              }

              const invokingMember = await this.getMember(message, { refresh: true });
              const memberHasManageRoles =
                invokingMember?.permissions?.has(PermissionFlags.ManageRoles) ||
                invokingMember?.permissions?.has(PermissionFlags.Administrator);

              if (!memberHasManageRoles) {
                await message.reply(t(lang, 'auditCatalog.handlers.CommandHandler.l257_reply')).catch(() => {});
                return;
              }

              const targetUserId = parseUserId(args[0]);
              if (!targetUserId) {
                await message
                  .reply(
                    t(lang, 'auditCatalog.handlers.CommandHandler.l263_reply', {
                      usedPrefix,
                      'customCmd.name': customCmd.name,
                    }),
                  )
                  .catch(() => {});
                return;
              }

              let targetMember = guild.members?.get(targetUserId) ?? null;
              if (!targetMember) {
                targetMember = await guild.fetchMember(targetUserId).catch(() => null);
              }

              if (!targetMember) {
                await message.reply(t(lang, 'auditCatalog.handlers.CommandHandler.l273_reply')).catch(() => {});
                return;
              }

              let targetRole = guild.roles?.get(targetRoleId) ?? null;
              if (!targetRole && typeof guild.fetchRole === 'function') {
                targetRole = await guild.fetchRole(targetRoleId).catch(() => null);
              }

              if (!targetRole) {
                await message
                  .reply(
                    t(lang, 'auditCatalog.handlers.CommandHandler.l283_reply', { 'customCmd.name': customCmd.name }),
                  )
                  .catch(() => {});
                return;
              }

              const botUserId = this.client.user?.id;
              let botMember = botUserId ? (guild.members?.get(botUserId) ?? null) : null;
              if (!botMember && botUserId) {
                botMember = await guild.fetchMember(botUserId).catch(() => null);
              }

              const botHasManageRoles =
                botMember?.permissions?.has(PermissionFlags.ManageRoles) ||
                botMember?.permissions?.has(PermissionFlags.Administrator);

              if (!botHasManageRoles) {
                await message.reply(t(lang, 'auditCatalog.handlers.CommandHandler.l297_reply')).catch(() => {});
                return;
              }

              const targetRoleIds = targetMember?.roles?.roleIds ?? [];
              const hasRoleAlready = isArray(targetRoleIds) && targetRoleIds.includes(targetRoleId);

              try {
                if (actionType === 'addRole') {
                  if (!hasRoleAlready) await targetMember.roles.add(targetRoleId);
                  actionWord = 'added';
                } else if (actionType === 'removeRole') {
                  if (hasRoleAlready) await targetMember.roles.remove(targetRoleId);
                  actionWord = 'removed';
                } else if (hasRoleAlready) {
                  await targetMember.roles.remove(targetRoleId);
                  actionWord = 'removed';
                } else {
                  await targetMember.roles.add(targetRoleId);
                  actionWord = 'added';
                }
              } catch {
                await message.reply(t(lang, 'auditCatalog.handlers.CommandHandler.l313_reply')).catch(() => {});
                return;
              }

              targetMention = `<@${targetMember.id || targetUserId}>`;
              roleMention = `<@&${targetRoleId}>`;
            }

            const responseTemplate =
              typeof customCmd.response === 'string' && customCmd.response.trim().length > 0
                ? customCmd.response
                : ROLE_ACTIONS.includes(actionType)
                  ? '{target}: role {role} was {action}.'
                  : '{user}';

            const response = responseTemplate
              .replace(/\{user\}/gi, authorMention)
              .replace(/\{server\}/gi, message.guild?.name || 'this server')
              .replace(/\{channel\}/gi, channelId ? `<#${channelId}>` : '#unknown-channel')
              .replace(/\{target\}/gi, targetMention)
              .replace(/\{role\}/gi, roleMention)
              .replace(/\{action\}/gi, actionWord);

            const parsedColor =
              typeof customCmd.color === 'string' ? parseInt(customCmd.color.replace('#', ''), 16) : NaN;
            const payload = customCmd.embed
              ? (() => {
                  const embed = new EmbedBuilder()
                    .setDescription(response)
                    .setColor(Number.isFinite(parsedColor) ? parsedColor : 0x5865f2);
                  if (customCmd.title) embed.setTitle(customCmd.title);
                  return { embeds: [embed] };
                })()
              : response;

            if (actionType === 'sendDM') {
              const sent = await sendUserDm(this.client, message.author.id, payload);
              if (!sent) {
                await message.reply(t(lang, 'auditCatalog.handlers.CommandHandler.dmFailed')).catch(() => {});
              }
            } else {
              await message.reply(payload).catch(() => {});
            }

            statsService
              .recordCommand(`custom:${customCmd.name}`, guildId ?? undefined, message.author?.id)
              .catch(() => {});
            if (guildId) activityService.recordCommand(guildId, message.author?.id);

            if (customCmd.deleteTrigger && typeof message.delete === 'function') {
              await message.delete().catch(() => {});
            }

            return;
          }
        } catch {}
      }
      return;
    }

    if (guildId) {
      const settings = await settingsCache.get(guildId);
      const channelId = message.channelId || message.channel?.id;

      if (settings?.blacklistedChannels && isInUnion(channelId, settings.blacklistedChannels)) {
        const member = await this.getMember(message);
        const memberRoleIds = member?.roles?.roleIds ?? [];

        const isStaff = settings.staffRoleId && memberRoleIds.includes(settings.staffRoleId);
        const isAdmin =
          member?.permissions?.has(PermissionFlags.Administrator) ||
          member?.permissions?.has(PermissionFlags.ManageGuild);

        if (!isStaff && !isAdmin) {
          return;
        }
      }
    }

    if (guildId && command.category !== 'owner') {
      try {
        const settings = await settingsCache.get(guildId);
        const disabled = settings?.disabledCommands ?? [];
        if (disabled.length > 0) {
          const isDisabled = disabled.includes(command.name) || disabled.includes(command.category);
          if (isDisabled) {
            return;
          }
        }
      } catch {}
    }

    let guild = message.guild;
    if (!guild && guildId) {
      guild = this.client.guilds.get(guildId) ?? (await this.client.guilds.fetch(guildId).catch(() => null));
    }
    if (!guild && command.category !== 'owner' && !command.allowDM) {
      await message.reply(t(locale, 'commands.generic.serverOnly')).catch(() => {});
      return;
    }

    if (command.permissions && command.permissions.length > 0 && guild) {
      const member = await this.getMember(message, { refresh: true });
      if (!member) {
        await message.reply(t(locale, 'commands.generic.yourMemberNotFound')).catch(() => {});
        return;
      }

      const isGuildOwner = guild.ownerId && String(message.author?.id) === String(guild.ownerId);
      if (!isGuildOwner) {
        const hasPermission = command.permissions.some((perm) => {
          return member.permissions?.has(PermissionFlags[perm]);
        });

        if (!hasPermission) {
          await message
            .reply(
              t(locale, 'auditCatalog.handlers.CommandHandler.l412_reply', {
                requiredPermissions: command.permissions.join(', '),
              }),
            )
            .catch(() => {});
          return;
        }
      }
    }

    if (command.ownerOnly && config.ownerId) {
      if (message.author.id !== config.ownerId) {
        await message.reply(t(locale, 'commands.reload.ownerOnly')).catch(() => {});
        return;
      }
    }

    const cooldownInfo = this.checkCooldown(message.author.id, commandName);
    if (!cooldownInfo.ready) {
      if (this.shouldSendCooldownNotice(message.author.id)) {
        await message
          .reply(
            t(locale, 'auditCatalog.handlers.CommandHandler.l426_reply', {
              'cooldownInfo.remaining': cooldownInfo.remaining,
            }),
          )
          .catch(() => {});
      }
      return;
    }

    try {
      await command.execute(message, args, this.client, usedPrefix);
      statsService.recordCommand(command.name, guildId ?? undefined, message.author?.id).catch(() => {});
      if (guildId) activityService.recordCommand(guildId, message.author?.id);
    } catch (error: unknown) {
      const guildName = message.guild?.name || (message.guildId ? `Guild ${message.guildId}` : 'DM');

      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !${commandName} (ECONNRESET)`);
        await message
          .reply(
            'The Fluxer API is having connectivity issues, which is affecting bot functionality.\n' +
              'Check the status page to see if there are any ongoing incidents: <https://status.starlightnet.work>',
          )
          .catch(() => {});
      } else if (
        error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof error.message === 'string' &&
        (error.message.toLowerCase().includes('nsfw') || error.message.toLowerCase().includes('age restricted'))
      ) {
        console.warn(`[${guildName}] NSFW channel restriction blocked reply for !${commandName}`);
      } else if (
        error &&
        typeof error === 'object' &&
        (('statusCode' in error && error.statusCode === 404) ||
          ('message' in error &&
            typeof error.message === 'string' &&
            (error.message.toLowerCase().includes("wasn't found") ||
              error.message.toLowerCase().includes('not found'))))
      ) {
        console.warn(`[${guildName}] Message or channel not found during !${commandName} (user likely deleted it)`);
      } else if (
        error &&
        typeof error === 'object' &&
        (('statusCode' in error && error.statusCode === 403) ||
          ('message' in error &&
            typeof error.message === 'string' &&
            (error.message.toLowerCase().includes("don't have the permissions") ||
              error.message.toLowerCase().includes('missing permissions'))))
      ) {
        console.warn(`[${guildName}] Missing permissions during !${commandName}: ${messageFromError(error)}`);
      } else {
        console.error(`[${guildName}] Error in !${commandName}: ${messageFromError(error)}`);
        GlitchTip.captureException(error, {
          tags: { command: commandName, guild: guildName },
          extra: { args, guildId, userId: message.author?.id },
        });
        await message.reply(t(locale, 'commands.admin.automod.errorGeneric')).catch(() => {});

        if (config.ownerId) {
          try {
            const owner = await this.client.users.fetch(config.ownerId).catch(() => null);
            if (owner) {
              await owner
                .send(
                  `**Command error** in **${guildName}**
Command: \`!${commandName}\`
Error: \`${messageFromError(error)}\``,
                )
                .catch(() => {});
            }
          } catch {}
        }
      }
    }
  }

  async getMember(message: Message, options?: { refresh?: boolean }): Promise<GuildMember | null> {
    let guild = message.guild;

    if (!guild && message.guildId) {
      try {
        guild = await this.client.guilds.fetch(message.guildId);
      } catch {
        return null;
      }
    }

    if (!guild) return null;

    const authorId = message.author.id;

    if (options?.refresh) {
      await ensureGuildRolesLoaded(guild);
      try {
        return await guild.fetchMember(authorId);
      } catch {
        return guild.members?.get(authorId) ?? null;
      }
    }

    let member = guild.members?.get(authorId);

    if (!member) {
      try {
        member = await guild.fetchMember(authorId);
      } catch {
        return null;
      }
    }

    return member;
  }

  checkCooldown(userId: string, commandName: string): { ready: boolean; remaining: number } {
    const key = `${userId}-${commandName}`;
    const now = Date.now();
    const cooldownAmount = config.cooldown.default;

    if (this.cooldowns.has(key)) {
      const expirationTime = this.cooldowns.get(key)! + cooldownAmount;

      if (now < expirationTime) {
        const remaining = Math.ceil((expirationTime - now) / 1000);
        return { ready: false, remaining };
      }
    }

    this.cooldowns.set(key, now);

    setTimeout(() => {
      this.cooldowns.delete(key);
    }, cooldownAmount);

    return { ready: true, remaining: 0 };
  }

  private shouldSendCooldownNotice(userId: string): boolean {
    const now = Date.now();
    const lastNotice = this.cooldownNoticeAt.get(userId);
    if (lastNotice && now - lastNotice < COOLDOWN_NOTICE_INTERVAL_MS) return false;

    this.cooldownNoticeAt.set(userId, now);
    const timeout = setTimeout(() => {
      if (this.cooldownNoticeAt.get(userId) === now) this.cooldownNoticeAt.delete(userId);
    }, COOLDOWN_NOTICE_INTERVAL_MS);
    timeout.unref();
    return true;
  }

  checkCustomCommandCooldown(
    userId: string,
    guildId: string,
    commandName: string,
    cooldownSeconds: number,
  ): { ready: boolean; remaining: number } {
    if (cooldownSeconds <= 0) {
      return { ready: true, remaining: 0 };
    }

    const key = `${guildId}:${userId}:custom:${commandName}`;
    const now = Date.now();
    const cooldownAmount = cooldownSeconds * 1000;

    if (this.customCommandCooldowns.has(key)) {
      const expirationTime = this.customCommandCooldowns.get(key)! + cooldownAmount;

      if (now < expirationTime) {
        const remaining = Math.ceil((expirationTime - now) / 1000);
        return { ready: false, remaining };
      }
    }

    this.customCommandCooldowns.set(key, now);

    setTimeout(() => {
      this.customCommandCooldowns.delete(key);
    }, cooldownAmount);

    return { ready: true, remaining: 0 };
  }

  getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }

  getCommandsByCategory(): Record<string, Command[]> {
    const categories: Record<string, Command[]> = {};

    for (const [, command] of this.commands) {
      if (command.isAlias) continue;

      (categories[command.category] ??= []).push(command);
    }

    return categories;
  }
}
