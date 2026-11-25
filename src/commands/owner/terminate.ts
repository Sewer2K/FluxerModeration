import { Events } from '@fluxerjs/core';
import type { Client, Message, MessageReactionPayload } from '@fluxerjs/core';
import type { GatewayReactionEmoji } from '@fluxerjs/types';
import { Routes } from '@fluxerjs/types';
import type { Command } from '@/types';
import config from '@/config';
import isNetworkError from '@/utils/isNetworkError';
import { messageFromError } from '@/utils/messageFromError';
import { addBlock, removeBlock, getBlock, listBlocks } from '@/utils/serviceBlockCache';
import ServiceBlock from '@/models/ServiceBlock';

const CONFIRM_EMOJI = '✅';
const CANCEL_EMOJI = '❌';
const CONFIRM_TIMEOUT_MS = 60 * 1000;
const SNOWFLAKE = /^\d{17,20}$/;

function parseId(arg: string | undefined): string | null {
  if (!arg) return null;
  const trimmed = arg.trim().replace(/^<@!?/, '').replace(/>$/, '');
  return SNOWFLAKE.test(trimmed) ? trimmed : null;
}

function normalizeEmojiName(emoji: string | GatewayReactionEmoji | null | undefined): string {
  return (typeof emoji === 'string' ? emoji : (emoji?.name ?? ''))
    .replace(/[\uFE00-\uFE0F\u200D]/g, '')
    .trim()
    .toLowerCase();
}

function isConfirmEmoji(emoji: GatewayReactionEmoji | string | null | undefined): boolean {
  const name = normalizeEmojiName(emoji);
  return name === normalizeEmojiName(CONFIRM_EMOJI) || name === 'white_check_mark';
}

function isCancelEmoji(emoji: GatewayReactionEmoji | string | null | undefined): boolean {
  const name = normalizeEmojiName(emoji);
  return name === normalizeEmojiName(CANCEL_EMOJI) || name === 'x';
}

async function waitForOwnerConfirmation(
  client: Client,
  confirmationMessage: Message,
  ownerId: string,
): Promise<boolean> {
  if (typeof client.on !== 'function') return false;

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const cleanup = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.off(Events.MessageReactionAdd, handler);
      resolve(value);
    };

    const timeout = setTimeout(() => cleanup(false), CONFIRM_TIMEOUT_MS);
    timeout.unref();

    const handler = (payload: MessageReactionPayload) => {
      if (String(payload.reaction.messageId ?? '') !== String(confirmationMessage.id ?? '')) return;
      const confirmationChannelId = confirmationMessage.channelId;
      if (confirmationChannelId && String(payload.reaction.channelId ?? '') !== String(confirmationChannelId)) return;
      if (String(payload.user.id ?? '') !== ownerId || payload.user.bot) return;

      if (isConfirmEmoji(payload.reaction.emoji)) {
        cleanup(true);
      } else if (isCancelEmoji(payload.reaction.emoji)) {
        cleanup(false);
      }
    };

    client.on(Events.MessageReactionAdd, handler);
  });
}

async function confirm(client: Client, message: Message, ownerId: string, prompt: string): Promise<boolean> {
  const confirmationMessage = await message.reply(`${prompt}\n\n${CONFIRM_EMOJI} confirm\n${CANCEL_EMOJI} cancel`);
  try {
    await confirmationMessage.react(CONFIRM_EMOJI);
    await confirmationMessage.react(CANCEL_EMOJI);
  } catch {
    await message.reply('I could not add the confirmation reactions, so nothing was done.').catch(() => {});
    return false;
  }
  return waitForOwnerConfirmation(client, confirmationMessage, ownerId);
}

// best effort, we still block the guild even if we can't find its owner
async function resolveGuildOwnerId(client: Client, guildId: string): Promise<string | null> {
  const cached = client.guilds.get(guildId);
  if (cached?.ownerId) return String(cached.ownerId);
  try {
    const data = (await client.rest.get(Routes.guild(guildId))) as { owner_id?: string };
    return data?.owner_id ? String(data.owner_id) : null;
  } catch {
    return null;
  }
}

const command: Command = {
  name: 'terminate',
  description: `Owner-only. Soft-block a guild or user from ${config.branding.publicName} under the ToS.`,
  usage: 'guild|user|unguild|unuser|check|list <id> [reason]',
  category: 'owner',
  ownerOnly: true,
  allowDM: true,
  cooldown: 0,

  async execute(message, args, client, prefix = '!') {
    const ownerId = config.ownerId;
    const authorId = message.author.id;

    if (!ownerId || authorId !== ownerId) {
      return void (await message.reply('This command is restricted to the bot owner.'));
    }

    const sub = (args[0] ?? '').toLowerCase();

    try {
      if (sub === 'guild') {
        const guildId = parseId(args[1]);
        const reason = args.slice(2).join(' ').trim();
        if (!guildId || !reason) {
          return void (await message.reply(`Usage: \`${prefix}terminate guild <guildId> <reason>\``));
        }

        const ownerOfGuild = await resolveGuildOwnerId(client, guildId);
        const ownerNote = ownerOfGuild
          ? `Its owner \`${ownerOfGuild}\` will be terminated too.`
          : 'I could not resolve its owner, so only the guild will be terminated.';

        const ok = await confirm(client, message, ownerId, `Terminate guild \`${guildId}\`?\n${ownerNote}`);
        if (!ok) return void (await message.reply('Cancelled. Nothing was terminated.'));

        await addBlock({
          targetType: 'guild',
          targetId: guildId,
          reason,
          evidence: null,
          addedBy: authorId,
          linkedGuildId: null,
        });

        if (ownerOfGuild) {
          await addBlock({
            targetType: 'user',
            targetId: ownerOfGuild,
            reason: `Owner of terminated guild ${guildId}: ${reason}`,
            evidence: null,
            addedBy: authorId,
            linkedGuildId: guildId,
          });
          await message.reply(
            `Terminated guild \`${guildId}\` and its owner \`${ownerOfGuild}\`. The bot stays in the guild.`,
          );
        } else {
          await message.reply(
            `Terminated guild \`${guildId}\`. Owner not found, so no owner block was added. The bot stays in the guild.`,
          );
        }
        return;
      }

      if (sub === 'user') {
        const userId = parseId(args[1]);
        const reason = args.slice(2).join(' ').trim();
        if (!userId || !reason) {
          return void (await message.reply(`Usage: \`${prefix}terminate user <userId> <reason>\``));
        }

        const ok = await confirm(client, message, ownerId, `Terminate user \`${userId}\`?`);
        if (!ok) return void (await message.reply('Cancelled. Nothing was terminated.'));

        await addBlock({
          targetType: 'user',
          targetId: userId,
          reason,
          evidence: null,
          addedBy: authorId,
          linkedGuildId: null,
        });
        await message.reply(`Terminated user \`${userId}\`.`);
        return;
      }

      if (sub === 'unguild') {
        const guildId = parseId(args[1]);
        if (!guildId) return void (await message.reply(`Usage: \`${prefix}terminate unguild <guildId>\``));

        const removed = await removeBlock('guild', guildId);

        // clear any owner blocks that were cascaded from this guild
        const linked = await ServiceBlock.find({ targetType: 'user', linkedGuildId: guildId }).lean();
        let clearedOwners = 0;
        for (const block of linked) {
          if (await removeBlock('user', block.targetId)) clearedOwners++;
        }

        if (!removed && clearedOwners === 0) {
          return void (await message.reply(`\`${guildId}\` was not terminated.`));
        }
        await message.reply(
          `Restored guild \`${guildId}\`.${clearedOwners > 0 ? ` Cleared ${clearedOwners} linked owner block(s).` : ''}`,
        );
        return;
      }

      if (sub === 'unuser') {
        const userId = parseId(args[1]);
        if (!userId) return void (await message.reply(`Usage: \`${prefix}terminate unuser <userId>\``));

        const removed = await removeBlock('user', userId);
        await message.reply(removed ? `Restored user \`${userId}\`.` : `\`${userId}\` was not terminated.`);
        return;
      }

      if (sub === 'check') {
        const id = parseId(args[1]);
        if (!id) return void (await message.reply(`Usage: \`${prefix}terminate check <id>\``));

        const guildBlock = await getBlock('guild', id);
        const userBlock = await getBlock('user', id);
        if (!guildBlock && !userBlock) {
          return void (await message.reply(`\`${id}\` is not terminated.`));
        }

        const lines: string[] = [];
        if (guildBlock) lines.push(`Guild: terminated by \`${guildBlock.addedBy}\` — ${guildBlock.reason}`);
        if (userBlock) {
          const link = userBlock.linkedGuildId ? ` (cascaded from guild \`${userBlock.linkedGuildId}\`)` : '';
          lines.push(`User: terminated by \`${userBlock.addedBy}\`${link} — ${userBlock.reason}`);
        }
        await message.reply(lines.join('\n'));
        return;
      }

      if (sub === 'list') {
        const filter = args[1]?.toLowerCase();
        const targetType = filter === 'guild' || filter === 'user' ? filter : undefined;
        const blocks = await listBlocks(targetType);
        if (blocks.length === 0) {
          return void (await message.reply('No active terminations.'));
        }

        const lines = blocks
          .slice(0, 30)
          .map((b) => `- ${b.targetType} \`${b.targetId}\`${b.linkedGuildId ? ' (cascade)' : ''} — ${b.reason}`);
        const extra = blocks.length > 30 ? `\n...and ${blocks.length - 30} more` : '';
        await message.reply(`Active terminations (${blocks.length}):\n${lines.join('\n')}${extra}`);
        return;
      }

      await message.reply(
        `Usage:\n` +
          `\`${prefix}terminate guild <guildId> <reason>\`\n` +
          `\`${prefix}terminate user <userId> <reason>\`\n` +
          `\`${prefix}terminate unguild <guildId>\`\n` +
          `\`${prefix}terminate unuser <userId>\`\n` +
          `\`${prefix}terminate check <id>\`\n` +
          `\`${prefix}terminate list [guild|user]\``,
      );
    } catch (error) {
      if (isNetworkError(error)) return;
      console.error(`[terminate] failed: ${messageFromError(error)}`);
      await message.reply('That failed before it finished. Check the logs.').catch(() => {});
    }
  },
};

export default command;
