import type { Command } from '@/types';
import { canManageRole } from '@/utils/permissions';
import isNetworkError from '@/utils/isNetworkError';
import settingsCache from '@/utils/settingsCache';
import { t, normalizeLocale } from '@/i18n';
import { fetchGuildRole, resolveRoleIdFromArg } from '@/utils/resolveGuildRole';
import { GuildMember } from '@fluxerjs/core';
import { isArray } from '@/utils/isArray';
import { messageFromError } from '@/utils/messageFromError';

const command: Command = {
  name: 'roleclear',
  description: 'Remove a role from every member who currently has it',
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
    if (!roleArg) return void (await message.reply(t(lang, 'commands.admin.roleclear.usage', { prefix })));

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
      if (!check.allowed) return void (await message.reply(check.reason || 'You cannot manage that role.'));
    }

    await message.reply(t(lang, 'commands.admin.roleclear.removing', { roleName: role.name }));

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
        console.warn(`[${guildName}] Fluxer API unreachable during !roleclear (ECONNRESET)`);
      } else {
        console.error(`[${guildName}] Error in !roleclear: ${messageFromError(err)}`);
      }
      return void (await message.reply(t(lang, 'commands.generic.membersFetchFailed')));
    }

    const hasRole = members.filter((m) => {
      if (typeof m.roles?.has === 'function') return m.roles.has(roleId);
      const ids = m.roles?.roleIds ?? (isArray(m.roles) ? m.roles : []);
      return ids.includes(roleId);
    });

    if (hasRole.length === 0) {
      return void (await message.reply(t(lang, 'commands.admin.roleclear.noMembersHaveRole', { roleName: role.name })));
    }

    let removed = 0,
      failed = 0;

    const BATCH_SIZE = 5;
    const BATCH_DELAY_MS = 1000;

    for (let i = 0; i < hasRole.length; i += BATCH_SIZE) {
      const batch = hasRole.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (m) => {
          try {
            await m.roles.remove(roleId);
            removed++;
          } catch (err: unknown) {
            failed++;
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[roleclear] Failed ${m.id} in ${guild.id}: ${msg}`);
          }
        }),
      );
      if (i + BATCH_SIZE < hasRole.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    let result = t(lang, 'commands.admin.roleclear.donePrefix', { roleName: role.name, removed });
    if (failed > 0) result += ' ' + t(lang, 'commands.admin.roleclear.doneFailedSuffix', { failed });
    return void (await message.reply(result));
  },
};

export default command;
