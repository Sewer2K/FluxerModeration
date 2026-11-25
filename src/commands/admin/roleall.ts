import type { GuildMember } from '@fluxerjs/core';
import type { Command } from '@/types';
import { canManageRole } from '@/utils/permissions';
import isNetworkError from '@/utils/isNetworkError';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import { beginBulkRoleUpdateSuppression, endBulkRoleUpdateSuppression, logServerEvent } from '@/utils/logger';
import { fetchGuildRole, resolveRoleIdFromArg } from '@/utils/resolveGuildRole';
import { isArray } from '@/utils/isArray';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'roleall',
  description: 'Assign a role to every non-bot member in the server - members who already have it are skipped',
  usage: '<@role or role ID>',
  category: 'admin',
  permissions: ['ManageRoles'],
  cooldown: 30,

  async execute(message, args, client, prefix = '!') {
    let guild = message.guild;
    if (!guild && message.guildId) guild = await client.guilds.fetch(message.guildId);
    if (!guild) return void (await message.reply(t('en', 'commands.generic.serverOnly')));

    const cached = await settingsCache.get(guild.id).catch(() => null);
    const lang = normalizeLocale(cached?.language);

    const roleArg = args[0];
    if (!roleArg) return void (await message.reply(t(lang, 'commands.admin.roleall.usage', { prefix })));

    const roleId = await resolveRoleIdFromArg(guild, roleArg);
    if (!roleId) return void (await message.reply(t(lang, 'commands.generic.invalidRoleInput')));

    const role = await fetchGuildRole(guild, roleId);
    if (!role) return void (await message.reply(t(lang, 'commands.generic.roleNotFound')));

    let moderator = guild.members?.get(message.author.id);
    if (!moderator) {
      try {
        moderator = await guild.fetchMember(message.author.id);
      } catch {}
    }
    if (moderator) {
      const check = canManageRole(moderator, role, guild);
      if (!check.allowed)
        return void (await message.reply(check.reason || t(lang, 'commands.generic.cannotManageRole')));
    }

    await message.reply(t(lang, 'commands.admin.roleall.assigning', { roleName: role.name }));

    let members: GuildMember[];
    try {
      members = [];
      let lastId: string | undefined;
      while (true) {
        const batch = await guild.members.fetch({ limit: 1000, ...(lastId && { after: lastId }) });
        members.push(...batch);

        if (batch.length < 1000) break;
        // `batch` is 1000-elements-long or longer here, it is certain that it's not empty here
        lastId = batch[batch.length - 1]!.id;
      }
    } catch (err) {
      const guildName = guild?.name || 'Unknown Server';
      if (isNetworkError(err)) {
        console.warn(`[${guildName}] Fluxer API unreachable during !roleall (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !roleall: ${messageFromError(err)}`);
      }
      return void (await message.reply(t(lang, 'commands.generic.membersFetchFailed')));
    }

    if (members.length === 0) {
      return void (await message.reply(t(lang, 'commands.admin.roleall.noMembersFound')));
    }

    const needsRole = members.filter((m) => {
      if (m.user?.bot) return false;
      if (typeof m.roles?.has === 'function') return !m.roles.has(roleId);
      const ids = m.roles?.roleIds ?? (isArray(m.roles) ? m.roles : []);
      return !ids.includes(roleId);
    });

    const skipped = members.filter((m) => !m.user?.bot).length - needsRole.length;
    let assigned = 0,
      failed = 0;

    const BATCH_SIZE = 5;
    const BATCH_DELAY_MS = 1000;

    beginBulkRoleUpdateSuppression(guild.id, 15 * 60 * 1000);
    try {
      for (let i = 0; i < needsRole.length; i += BATCH_SIZE) {
        const batch = needsRole.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (m) => {
            try {
              await m.roles.add(roleId);
              assigned++;
            } catch (err: unknown) {
              failed++;
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(`[roleall] Failed ${m.id} in ${guild.id}: ${msg}`);
            }
          }),
        );
        if (i + BATCH_SIZE < needsRole.length) {
          await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
        }
      }
    } finally {
      endBulkRoleUpdateSuppression(guild.id);
    }

    let result = t(lang, 'commands.admin.roleall.resultPrefix', { roleName: role.name, assigned });
    if (skipped > 0) result += ' ' + t(lang, 'commands.admin.roleall.skippedSuffix', { skipped });
    if (failed > 0) result += ' ' + t(lang, 'commands.admin.roleall.failedSuffix', { failed });

    await logServerEvent(
      guild,
      'Bulk Role Assignment',
      failed > 0 ? 0xf39c12 : 0x2ecc71,
      [
        { name: 'Role', value: `<@&${roleId}>`, inline: true },
        { name: 'Assigned', value: String(assigned), inline: true },
        { name: 'Already Had Role', value: String(skipped), inline: true },
        { name: 'Failed', value: String(failed), inline: true },
        { name: 'Executed By', value: `<@${message.author.id}>`, inline: true },
      ],
      client,
      {
        description: `Bulk role assignment completed for **${role.name}**.`,
        footer: `Role ID: ${roleId}`,
        eventType: 'member_role_update',
      },
    ).catch(() => {});

    return void (await message.reply(result));
  },
};

export default command;
