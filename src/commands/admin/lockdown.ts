import {
  OverwriteType,
  PermissionFlags,
  EmbedBuilder,
  Message,
  MessageSendOptions,
  Guild,
  Client,
  Channel,
  GuildChannel,
} from '@fluxerjs/core';
import { APIChannel, APIGuild, Routes } from '@fluxerjs/types';
import type { Command, IGuildSettings, IChannelOverwriteSnapshot } from '@/types';
import config from '@/config';
import LockdownState, { LockdownStateDocument } from '@/models/LockdownState';
import GuildSettings, { GuildSettingsDocument } from '@/models/GuildSettings';
import { logModAction } from '@/utils/logger';
import isNetworkError from '@/utils/isNetworkError';
import { t, normalizeLocale } from '@/i18n';
import { isGuildTextChannel } from '@/utils/isGuildTextChannel';
import { isArray } from '@/utils/isArray';
import { messageFromError } from '@/utils/messageFromError';
import { sendUserDm } from '@/utils/sendUserDm';

const LOCKDOWN_DENY_BITS = BigInt(PermissionFlags.SendMessages) | BigInt(PermissionFlags.AddReactions);

async function dmOperator(message: Message, client: Client, payload: string | MessageSendOptions): Promise<void> {
  await sendUserDm(client, message.author.id, payload);
}

const MAX_RETRIES = 2;
const PROGRESS_INTERVAL = 10;

async function handleConfig(
  message: Message,
  args: string[],
  guild: Guild,
  settings: GuildSettingsDocument,
  prefix: string,
) {
  const lang = normalizeLocale(settings?.language);
  const action = args[0]?.toLowerCase();

  if (!action) {
    return showConfig(message, settings, prefix);
  }

  const isOwner = config.ownerId && message.author.id === config.ownerId;
  const isGuildOwner = guild.ownerId && String(guild.ownerId) === String(message.author.id);
  if (!isOwner && !isGuildOwner) {
    let member = guild.members?.get(message.author.id);
    if (!member) {
      try {
        member = await guild.fetchMember(message.author.id);
      } catch {}
    }
    const hasAdmin = member?.permissions?.has(PermissionFlags.Administrator);
    if (!hasAdmin) {
      return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l34_reply'));
    }
  }

  const mention = args[1];
  if (!mention) {
    return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l40_reply', { prefix, action }));
  }

  const roleMatch =
    mention.match(/^<@&(\d+)>$/) ||
    (action === 'addrole' || action === 'removerole' ? mention.match(/^(\d{17,20})$/) : null);
  const userMatch =
    mention.match(/^<@!?(\d+)>$/) || (action === 'allow' || action === 'deny' ? mention.match(/^(\d{17,20})$/) : null);

  switch (action) {
    case 'addrole': {
      const roleId = roleMatch?.[1];
      if (!roleId) return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l48_reply', { prefix }));
      if (roleId === guild.id) return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l50_reply'));
      if (settings.lockdownRoles.includes(roleId))
        return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l51_reply'));
      settings.lockdownRoles.push(roleId);
      settings.markModified('lockdownRoles');
      await settings.save();
      return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l55_reply', { roleId }));
    }
    case 'removerole': {
      const roleId = roleMatch?.[1];
      if (!roleId) return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l58_reply', { prefix }));
      const idx = settings.lockdownRoles.indexOf(roleId);
      if (idx === -1) return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l61_reply'));
      settings.lockdownRoles.splice(idx, 1);
      settings.markModified('lockdownRoles');
      await settings.save();
      return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l65_reply', { roleId }));
    }
    case 'allow': {
      const roleId = roleMatch?.[1];
      if (roleId) {
        if (settings.lockdownAllowedRoles.includes(roleId)) {
          return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l70_reply'));
        }
        settings.lockdownAllowedRoles.push(roleId);
        settings.markModified('lockdownAllowedRoles');
        await settings.save();
        return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l74_reply', { roleId, prefix }));
      }
      const userId = userMatch?.[1];
      if (userId) {
        if (settings.lockdownAllowedUsers.includes(userId))
          return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l78_reply'));
        settings.lockdownAllowedUsers.push(userId);
        settings.markModified('lockdownAllowedUsers');
        await settings.save();
        return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l82_reply', { userId, prefix }));
      }
      return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l84_reply', { prefix }));
    }
    case 'deny': {
      const roleId = roleMatch?.[1];
      if (roleId) {
        const idx = settings.lockdownAllowedRoles.indexOf(roleId);
        if (idx === -1) return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l90_reply'));
        settings.lockdownAllowedRoles.splice(idx, 1);
        settings.markModified('lockdownAllowedRoles');
        await settings.save();
        return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l94_reply', { roleId, prefix }));
      }
      const userId = userMatch?.[1];
      if (userId) {
        const idx = settings.lockdownAllowedUsers.indexOf(userId);
        if (idx === -1) return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l99_reply'));
        settings.lockdownAllowedUsers.splice(idx, 1);
        settings.markModified('lockdownAllowedUsers');
        await settings.save();
        return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l103_reply', { userId, prefix }));
      }
      return message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l105_reply', { prefix }));
    }
    default:
      return message.reply(
        '**Lockdown config commands:**\n' +
          `\`${prefix}lockdown config\` - view current settings\n` +
          `\`${prefix}lockdown config addrole @Role\` - add a role to lock during lockdown\n` +
          `\`${prefix}lockdown config removerole @Role\` - remove a role from lockdown targets\n` +
          `\`${prefix}lockdown config allow @Role/@User\` - grant lockdown command access\n` +
          `\`${prefix}lockdown config deny @Role/@User\` - revoke lockdown command access`,
      );
  }
}

async function showConfig(message: Message, settings: IGuildSettings, prefix: string) {
  const lang = normalizeLocale(settings?.language);
  const targetRoles = settings.lockdownRoles.length
    ? settings.lockdownRoles.map((id: string) => `<@&${id}>`).join(', ')
    : 'None (only @everyone)';

  const allowedRoles = settings.lockdownAllowedRoles.length
    ? settings.lockdownAllowedRoles.map((id: string) => `<@&${id}>`).join(', ')
    : 'None';

  const allowedUsers = settings.lockdownAllowedUsers.length
    ? settings.lockdownAllowedUsers.map((id: string) => `<@${id}>`).join(', ')
    : 'None';

  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'auditCatalog.commands.admin.lockdown.l133_setTitle'))
    .setColor(0x3498db)
    .addFields(
      {
        name: t(lang, 'auditCatalog.commands.admin.lockdown.l136_addFields_name'),
        value: t(lang, 'auditCatalog.commands.admin.lockdown.l136_addFields_value', { targetRoles }),
        inline: false,
      },
      { name: t(lang, 'auditCatalog.commands.admin.lockdown.l137_addFields_name'), value: allowedRoles, inline: true },
      { name: t(lang, 'auditCatalog.commands.admin.lockdown.l138_addFields_name'), value: allowedUsers, inline: true },
    )
    .setDescription(
      '**Commands:**\n' +
        `\`${prefix}lockdown config addrole @Role\` - add a role to lock\n` +
        `\`${prefix}lockdown config removerole @Role\` - remove a role\n` +
        `\`${prefix}lockdown config allow @Role/@User\` - grant access\n` +
        `\`${prefix}lockdown config deny @Role/@User\` - revoke access`,
    );

  return message.reply({ embeds: [embed] });
}

function getLockdownRoleIds(guild: Guild, settings: IGuildSettings): string[] {
  const roleIds = [guild.id];
  for (const id of settings.lockdownRoles) {
    if (!roleIds.includes(id)) roleIds.push(id);
  }
  return roleIds;
}

async function lockServer(
  message: Message,
  guild: Guild,
  state: LockdownStateDocument,
  settings: IGuildSettings,
  client: Client,
  prefix: string,
): Promise<void> {
  const lang = normalizeLocale(settings?.language);
  const roleIds = getLockdownRoleIds(guild, settings);

  let channels: Channel[];
  try {
    channels = await guild.fetchChannels();
  } catch (fetchErr) {
    console.warn(`[lockdown] guild.fetchChannels() failed for ${guild.name}: ${(fetchErr as Error).message}`);
    channels = [];
  }

  if (channels.length === 0) {
    try {
      const raw = (await client.rest.get(Routes.guildChannels(guild.id))) as APIChannel[];
      if (isArray(raw) && raw.length > 0) {
        channels = raw
          .map((ch) => Channel.from(client, ch))
          // this is silly and wrong. @fluxerjs/v1.4.0 marks `Channel.from` as able to return `null` but no logic within it
          // can do so. This can be removed in FluxerJS v2
          .filter((ch) => ch !== null);
        console.log(`[lockdown] Used raw REST fallback for ${guild.name}: ${raw.length} channels`);
      }
    } catch (restErr) {
      console.warn(`[lockdown] REST channel fetch also failed for ${guild.name}: ${(restErr as Error).message}`);
    }
  }

  if (channels.length === 0) {
    channels = [...guild.channels.values()];
  }

  const textChannels = channels.filter(isGuildTextChannel);

  if (textChannels.length === 0) {
    return void (await message.reply(
      'No text channels found to lock down. This usually means the bot could not fetch channels from the Fluxer API.\n' +
        'Check that the bot has **View Channels** permission and try again in a moment.',
    ));
  }

  const roleCount = roleIds.length;
  const roleLabel = roleCount === 1 ? '@everyone' : `@everyone + ${roleCount - 1} role(s)`;
  const statusMsg = await message.reply(
    t(lang, 'auditCatalog.commands.admin.lockdown.l198_reply', {
      'textChannels.length': textChannels.length,
      roleLabel,
    }),
  );

  const snapshots: IChannelOverwriteSnapshot[] = [];
  for (const channel of textChannels) {
    for (const roleId of roleIds) {
      const existing = channel.permissionOverwrites.cache.get(roleId);

      snapshots.push({
        channelId: channel.id,
        roleId,
        previousAllow: existing ? existing.allow.toJSON() : '0',
        previousDeny: existing ? existing.deny.toJSON() : '0',
        hadOverwrite: !!existing,
      });
    }
  }

  let invitesWereDisabled = false;
  try {
    const guildData = (await client.rest.get(Routes.guild(guild.id))) as APIGuild;
    invitesWereDisabled = (guildData?.features || []).includes('INVITES_DISABLED');
  } catch (err) {
    console.warn(`[lockdown] Failed to inspect invites for ${guild.name}: ${messageFromError(err)}`);
  }

  state.active = true;
  state.phase = 'locking';
  state.lockedBy = message.author.id;
  state.lockedAt = new Date();
  state.invitesWereDisabled = invitesWereDisabled;
  state.channelSnapshots = snapshots;
  await state.save();

  const channelById = new Map(textChannels.map((channel) => [channel.id, channel]));
  let locked = 0;
  let failed = 0;
  let overwriteCount = 0;

  for (const snapshot of snapshots) {
    const channel = channelById.get(snapshot.channelId);
    const roleId = snapshot.roleId || guild.id;
    if (!channel) {
      failed++;
      overwriteCount++;
      continue;
    }

    try {
      const existingDeny = BigInt(snapshot.previousDeny || '0');
      const existingAllow = BigInt(snapshot.previousAllow || '0');
      const newDeny = existingDeny | LOCKDOWN_DENY_BITS;
      const newAllow = existingAllow & ~LOCKDOWN_DENY_BITS;

      let success = false;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          await channel.permissionOverwrites.edit(roleId, {
            type: OverwriteType.Role,
            allow: String(newAllow),
            deny: String(newDeny),
          });
          success = true;
          break;
        } catch (err) {
          if (
            err &&
            typeof err === 'object' &&
            'name' in err &&
            err.name === 'RateLimitError' &&
            attempt < MAX_RETRIES
          ) {
            const delay =
              ('retryAfter' in err && err.retryAfter && typeof err.retryAfter === 'number' ? err.retryAfter : 1) * 1000;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          if (isNetworkError(err) && attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          if (!isNetworkError(err)) {
            console.error(
              `[${guild.name}] Failed to lock channel #${channel.name} (${channel.id}) for role ${roleId}: ${messageFromError(err)}`,
            );
          }
          break;
        }
      }

      if (success) locked++;
      else failed++;
    } catch (err) {
      failed++;
      console.error(
        `[${guild.name}] Failed to prepare lockdown for channel ${snapshot.channelId}, role ${roleId}: ${messageFromError(err)}`,
      );
    }

    overwriteCount++;

    if (overwriteCount % PROGRESS_INTERVAL === 0) {
      try {
        await statusMsg.edit({
          content: t(lang, 'auditCatalog.commands.admin.lockdown.l256_edit', { overwriteCount, locked, failed }),
        });
      } catch {}
    }
  }

  let invitesDisabled = false;
  try {
    const guildData = (await client.rest.get(Routes.guild(guild.id))) as APIGuild;
    const features: string[] = guildData?.features || [];
    const alreadyDisabled = features.includes('INVITES_DISABLED');

    if (!alreadyDisabled) {
      await client.rest.patch(Routes.guild(guild.id), {
        body: { features: [...features, 'INVITES_DISABLED'] },
      });
      invitesDisabled = true;
    }
  } catch (err) {
    console.warn(`[lockdown] Failed to disable invites for ${guild.name}: ${messageFromError(err)}`);
  }

  state.phase = 'active';
  await state.save();

  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'auditCatalog.commands.admin.lockdown.l286_setTitle'))
    .setColor(0xe74c3c)
    .setDescription(
      `All text channels have been locked. Members can no longer send messages or add reactions.` +
        (invitesDisabled ? ` Server invites have been temporarily disabled.` : '') +
        `\n\nUse \`${prefix}lockdown\` again to unlock the server.`,
    )
    .addFields(
      { name: t(lang, 'auditCatalog.commands.admin.lockdown.l294_addFields_name'), value: `${locked}`, inline: true },
      { name: t(lang, 'auditCatalog.commands.admin.lockdown.l295_addFields_name'), value: `${failed}`, inline: true },
      {
        name: t(lang, 'auditCatalog.commands.admin.lockdown.l296_addFields_name'),
        value: `<@${message.author.id}>`,
        inline: true,
      },
      {
        name: t(lang, 'auditCatalog.commands.admin.lockdown.l297_addFields_name'),
        value: invitesDisabled ? 'Disabled' : state.invitesWereDisabled ? 'Already disabled' : 'Could not disable',
        inline: true,
      },
      {
        name: t(lang, 'auditCatalog.commands.admin.lockdown.l298_addFields_name'),
        value: roleIds.map((id: string) => (id === guild.id ? '@everyone' : `<@&${id}>`)).join(', '),
        inline: false,
      },
    );

  try {
    await statusMsg.edit({ embeds: [embed] });
  } catch {
    await message.reply({ embeds: [embed] }).catch(() => {});
  }
  await dmOperator(message, client, { embeds: [embed] });

  await logModAction(
    guild,
    message.author,
    null,
    'lockdown',
    `Server lockdown activated - ${locked} overwrite(s) across ${textChannels.length} channel(s)`,
    { client },
  ).catch(() => {});
}

async function unlockServer(
  message: Message,
  guild: Guild,
  state: LockdownStateDocument,
  settings: IGuildSettings,
  client: Client,
) {
  const lang = normalizeLocale(settings?.language);
  state.phase = 'unlocking';
  await state.save();
  let channels: GuildChannel[];
  try {
    channels = await guild.fetchChannels();
  } catch {
    channels = [];
  }
  if (channels.length === 0) {
    try {
      const raw = (await client.rest.get(Routes.guildChannels(guild.id))) as APIChannel[];
      if (isArray(raw) && raw.length > 0)
        channels = raw
          .map((ch) => Channel.from(client, ch))
          // this is silly and wrong. @fluxerjs/v1.4.0 marks `Channel.from` as able to return `null` but no logic within it
          // can do so. This can be removed in FluxerJS v2
          .filter((x) => x !== null)
          .filter(isGuildTextChannel);
    } catch {}
  }
  if (channels.length === 0) {
    channels = [...guild.channels.values()];
  }

  const unlockingText = t(lang, 'auditCatalog.commands.admin.lockdown.l327_reply', {
    'state.channelSnapshots.length': state.channelSnapshots.length,
  });
  let statusMsg: Message | null = null;
  try {
    statusMsg = await message.reply(unlockingText);
  } catch {
    /* bot may not be able to send in a locked channel */
  }
  await dmOperator(message, client, unlockingText);

  let unlocked = 0;
  let failed = 0;
  const remainingSnapshots: IChannelOverwriteSnapshot[] = [];

  for (const snapshot of state.channelSnapshots) {
    const roleId = snapshot.roleId || guild.id;
    const channel = channels.find((ch) => ch.id === snapshot.channelId) || guild.channels.get(snapshot.channelId);
    if (!channel) {
      failed++;
      remainingSnapshots.push(snapshot);
      continue;
    }

    let success = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (!snapshot.hadOverwrite) {
          try {
            await channel.permissionOverwrites.delete(roleId);
          } catch (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delErr: any
          ) {
            if (delErr.code !== 10003 && delErr.statusCode !== 404) throw delErr;
          }
        } else {
          await channel.permissionOverwrites.edit(roleId, {
            type: OverwriteType.Role,
            allow: snapshot.previousAllow,
            deny: snapshot.previousDeny,
          });
        }
        success = true;
        break;
      } catch (err) {
        if (err && typeof err === 'object' && 'name' in err && err.name === 'RateLimitError' && attempt < MAX_RETRIES) {
          const delay =
            ('retryAfter' in err && err.retryAfter && typeof err.retryAfter === 'number' ? err.retryAfter : 1) * 1000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        if (isNetworkError(err) && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        if (!isNetworkError(err)) {
          console.error(
            `[${guild.name}] Failed to unlock channel #${channel.name} (${channel.id}) for role ${roleId}: ${messageFromError(err)}`,
          );
        }
        break;
      }
    }

    if (success) unlocked++;
    else {
      failed++;
      remainingSnapshots.push(snapshot);
    }
  }

  let invitesRestored = false;
  let inviteRestoreFailed = false;
  if (failed === 0 && !state.invitesWereDisabled) {
    try {
      const guildData = (await client.rest.get(Routes.guild(guild.id))) as APIGuild;
      const features: string[] = guildData?.features || [];
      if (features.includes('INVITES_DISABLED')) {
        await client.rest.patch(Routes.guild(guild.id), {
          body: { features: features.filter((f: string) => f !== 'INVITES_DISABLED') },
        });
        invitesRestored = true;
      }
    } catch (err) {
      inviteRestoreFailed = true;
      console.warn(`[lockdown] Failed to re-enable invites for ${guild.name}: ${messageFromError(err)}`);
    }
  }

  const restoreIncomplete = remainingSnapshots.length > 0 || inviteRestoreFailed;
  state.active = restoreIncomplete;
  state.phase = restoreIncomplete ? 'active' : 'idle';
  state.channelSnapshots = remainingSnapshots;
  if (!restoreIncomplete) {
    state.lockedBy = null;
    state.lockedAt = null;
    state.invitesWereDisabled = false;
  }
  await state.save();

  const incompleteDetails: string[] = [];
  if (remainingSnapshots.length > 0) {
    incompleteDetails.push(`${unlocked} overwrite(s) were restored; ${failed} could not be restored.`);
  }
  if (inviteRestoreFailed) incompleteDetails.push('Server invites could not be re-enabled.');

  const unlockDescription = restoreIncomplete
    ? `${incompleteDetails.join(' ')} Run the lockdown command again to retry.`
    : `All text channels have been unlocked. Normal permissions have been restored.` +
      (invitesRestored ? ` Server invites have been re-enabled.` : '') +
      `\n\nThe server is now operating normally.`;

  const embed = new EmbedBuilder()
    .setTitle(
      restoreIncomplete ? 'Lockdown restore incomplete' : t(lang, 'auditCatalog.commands.admin.lockdown.l403_setTitle'),
    )
    .setColor(restoreIncomplete ? 0xe67e22 : 0x2ecc71)
    .setDescription(unlockDescription)
    .addFields(
      { name: t(lang, 'auditCatalog.commands.admin.lockdown.l411_addFields_name'), value: `${unlocked}`, inline: true },
      { name: t(lang, 'auditCatalog.commands.admin.lockdown.l412_addFields_name'), value: `${failed}`, inline: true },
      {
        name: t(lang, 'auditCatalog.commands.admin.lockdown.l413_addFields_name'),
        value: `<@${message.author.id}>`,
        inline: true,
      },
    );

  try {
    if (statusMsg) await statusMsg.edit({ embeds: [embed] });
    else await message.reply({ embeds: [embed] });
  } catch {
    await message.reply({ embeds: [embed] }).catch(() => {});
  }
  await dmOperator(message, client, { embeds: [embed] });

  await logModAction(
    guild,
    message.author,
    null,
    'lockdown',
    restoreIncomplete
      ? `Server lockdown restore incomplete - ${unlocked} overwrite(s) restored, ${failed} failed`
      : `Server lockdown lifted - ${unlocked} overwrite(s) restored`,
    { client },
  ).catch(() => {});
}

async function handleRemoteLock(message: Message, targetGuildId: string, client: Client, prefix: string) {
  try {
    if (!/^\d{17,20}$/.test(targetGuildId)) {
      return message.reply(t('en', 'auditCatalog.commands.admin.lockdown.l428_reply'));
    }

    const state = await LockdownState.getOrCreate(targetGuildId);
    if (state.active) {
      return message.reply(t('en', 'auditCatalog.commands.admin.lockdown.l433_reply', { targetGuildId }));
    }

    let guild = client.guilds.get(targetGuildId) ?? null;
    if (!guild) {
      try {
        guild = await client.guilds.fetch(targetGuildId);
      } catch {
        guild = null;
      }
    }
    if (!guild) {
      return void (await message.reply(t('en', 'auditCatalog.commands.admin.lockdown.l441_reply', { targetGuildId })));
    }

    const settings = await GuildSettings.getOrCreate(targetGuildId);

    await message.reply(
      t('en', 'auditCatalog.commands.admin.lockdown.l447_reply', { 'guild.name': guild.name, 'guild.id': guild.id }),
    );

    await lockServer(message, guild, state, settings, client, prefix);
  } catch (error) {
    if (isNetworkError(error)) {
      console.warn(`Fluxer API unreachable during DM !lockdown start (ECONNRESET)`);
      message.reply(t('en', 'auditCatalog.commands.admin.lockdown.connectivityError')).catch(() => {});
    } else {
      const errorMessage = `${messageFromError(error)}`;
      console.error(`Error in DM !lockdown start: ${errorMessage}`);
      message
        .reply(
          t('en', 'auditCatalog.commands.admin.lockdown.genericError', {
            errorMessage,
          }),
        )
        .catch(() => {});
    }
  }
}

async function handleRemoteUnlock(message: Message, targetGuildId: string, client: Client) {
  try {
    if (!/^\d{17,20}$/.test(targetGuildId)) {
      return message.reply(t('en', 'auditCatalog.commands.admin.lockdown.l465_reply'));
    }

    const state = await LockdownState.getOrCreate(targetGuildId);
    if (!state.active) {
      return message.reply(t('en', 'auditCatalog.commands.admin.lockdown.l470_reply', { targetGuildId }));
    }

    let guild = client.guilds.get(targetGuildId) ?? null;
    if (!guild) {
      try {
        guild = await client.guilds.fetch(targetGuildId);
      } catch {
        guild = null;
      }
    }
    if (!guild) return message.reply(t('en', 'auditCatalog.commands.admin.lockdown.l478_reply', { targetGuildId }));

    const settings = await GuildSettings.getOrCreate(targetGuildId);

    await message.reply(
      t('en', 'auditCatalog.commands.admin.lockdown.l484_reply', { 'guild.name': guild.name, 'guild.id': guild.id }),
    );

    await unlockServer(message, guild, state, settings, client);
  } catch (error) {
    if (isNetworkError(error)) {
      console.warn(`Fluxer API unreachable during DM !lockdown end (ECONNRESET)`);
      message.reply(t('en', 'auditCatalog.commands.admin.lockdown.connectivityError')).catch(() => {});
    } else {
      const errorMessage = `${messageFromError(error)}`;
      console.error(`Error in DM !lockdown end: ${errorMessage}`);
      message
        .reply(
          t('en', 'auditCatalog.commands.admin.lockdown.genericError', {
            errorMessage,
          }),
        )
        .catch(() => {});
    }
  }
}

const command: Command = {
  name: 'lockdown',
  description:
    'Lock down the entire server by denying SendMessages and AddReactions for @everyone (and configured roles) in all text channels. Run again to unlock.',
  usage: '[config]',
  category: 'admin',
  allowDM: true,
  cooldown: 10,

  async execute(message, args, client, prefix = '!'): Promise<void> {
    const isOwner = config.ownerId && message.author.id === config.ownerId;

    if (!message.guild && !message.guildId) {
      if (!isOwner) {
        return void (await message.reply(t('en', 'commands.generic.serverOnly')));
      }

      const sub = args[0]?.toLowerCase();
      const targetGuildId = args[1]?.trim();

      if (sub === 'start' && targetGuildId) {
        return void (await handleRemoteLock(message, targetGuildId, client, prefix));
      }

      if (sub === 'end' && targetGuildId) {
        return void (await handleRemoteUnlock(message, targetGuildId, client));
      }

      return void (await message.reply(
        `**DM usage:**\n` +
          `\`${prefix}lockdown start <server ID>\` - lock down a server\n` +
          `\`${prefix}lockdown end <server ID>\` - lift a lockdown`,
      ));
    }

    let guild = message.guild;
    if (!guild && message.guildId) {
      guild = await client.guilds.fetch(message.guildId);
    }
    if (!guild) {
      return void (await message.reply(t('en', 'commands.generic.serverOnly')));
    }

    const settings = await GuildSettings.getOrCreate(guild.id);
    const lang = normalizeLocale(settings?.language);

    if (!isOwner) {
      let member = guild.members?.get(message.author.id);
      if (!member) {
        try {
          member = await guild.fetchMember(message.author.id);
        } catch {}
      }
      if (!member) {
        return void (await message.reply(t(lang, 'commands.generic.yourMemberNotFound')));
      }
      const hasAdmin = member.permissions?.has(PermissionFlags.Administrator);
      const isGuildOwner = guild.ownerId && String(guild.ownerId) === String(message.author.id);
      const isAllowedUser = (settings?.lockdownAllowedUsers ?? []).includes(message.author.id);
      const memberRoles = member.roles.roleIds;
      const isAllowedRole = (settings?.lockdownAllowedRoles ?? []).some((r: string) => memberRoles.includes(r));

      if (!hasAdmin && !isGuildOwner && !isAllowedUser && !isAllowedRole) {
        return void (await message.reply(t(lang, 'auditCatalog.commands.admin.lockdown.l560_reply')));
      }
    }

    const sub = args[0]?.toLowerCase();
    if (sub === 'config') {
      return void (await handleConfig(message, args.slice(1), guild, settings, prefix));
    }

    try {
      const state = await LockdownState.getOrCreate(guild.id);

      if (state.active) {
        await unlockServer(message, guild, state, settings, client);
      } else {
        await lockServer(message, guild, state, settings, client, prefix);
      }
    } catch (error) {
      const guildName = guild?.name || 'Unknown Server';
      const failText = isNetworkError(error)
        ? t(lang, 'auditCatalog.commands.admin.lockdown.connectivityError')
        : t(lang, 'auditCatalog.commands.admin.lockdown.l584_reply');
      if (isNetworkError(error)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !lockdown (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !lockdown: ${messageFromError(error)}`);
      }
      message.reply(failText).catch(() => {});
      await dmOperator(message, client, failText);
    }
  },
};

export default command;
