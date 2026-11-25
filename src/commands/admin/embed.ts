import type { Command } from '@/types';
import { validateEmbedPayload, parseWebhookTarget } from '@/utils/embedPayload';
import { messageFromError } from '@/utils/messageFromError';
import { sendGuildEmbedViaBot, sendGuildEmbedViaWebhook } from '@/utils/sendGuildEmbed';

function parseChannelId(raw?: string): string | null {
  if (!raw) return null;
  const mention = raw.match(/^<#(\d{17,20})>$/);
  if (mention && '1' in mention) return mention[1];
  if (/^\d{17,20}$/.test(raw)) return raw;
  return null;
}

function extractJsonArg(args: string[]): string | null {
  const joined = args.join(' ').trim();
  const start = joined.indexOf('{');
  if (start === -1) return null;
  return joined.slice(start);
}

const command: Command = {
  name: 'embed',
  description: [
    'Build and send a Fluxer embed from JSON.',
    '',
    '**Send as the bot:**',
    '`!embed send #channel {"title":"Hello","description":"World","color":"#5865f2"}`',
    '',
    '**Send via webhook:**',
    '`!embed webhook https://your-fluxer-api.example/webhooks/<id>/<token> {"title":"Hello"}`',
    '',
    'Embed JSON supports `title`, `description`, `color`, `url`, `footer`, `thumbnail`, `image`, and `fields`.',
  ].join('\n'),
  usage: 'send #channel <json> | webhook <url> <json>',
  category: 'admin',
  permissions: ['ManageMessages'],
  cooldown: 5,

  async execute(message, args, client, prefix = '!') {
    const guild = message.guild;
    if (!guild) {
      return void (await message.reply('This command only works in a server.'));
    }

    const sub = args[0]?.toLowerCase();
    if (!sub || sub === 'help') {
      return void (await message.reply(command.description as string));
    }

    if (sub === 'send') {
      const channelId = parseChannelId(args[1]);
      if (!channelId) {
        return void (await message.reply(`Usage: \`${prefix}embed send #channel <json>\``));
      }

      const jsonRaw = extractJsonArg(args.slice(2));
      if (!jsonRaw) {
        return void (await message.reply(
          `Provide embed JSON. Example: \`${prefix}embed send #general {"title":"Hi"}\``,
        ));
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(jsonRaw);
      } catch {
        return void (await message.reply('Invalid JSON. Check quotes and braces.'));
      }

      const validated = validateEmbedPayload(parsedJson);
      if (!validated.ok) {
        return void (await message.reply(validated.error));
      }

      try {
        await sendGuildEmbedViaBot(client, channelId, validated.payload);
        return void (await message.reply(`Embed sent to <#${channelId}>.`));
      } catch (err) {
        return void (await message.reply(`Failed to send embed: ${messageFromError(err, 'unknown error')}`));
      }
    }

    if (sub === 'webhook') {
      const webhookUrl = args[1];
      const target = parseWebhookTarget({ webhookUrl });
      if (!target) {
        return void (await message.reply(
          `Usage: \`${prefix}embed webhook https://your-fluxer-api.example/webhooks/<id>/<token> <json>\``,
        ));
      }

      const jsonRaw = extractJsonArg(args.slice(2));
      if (!jsonRaw) {
        return void (await message.reply('Provide embed JSON after the webhook URL.'));
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(jsonRaw);
      } catch {
        return void (await message.reply('Invalid JSON. Check quotes and braces.'));
      }

      const validated = validateEmbedPayload(parsedJson);
      if (!validated.ok) {
        return void (await message.reply(validated.error));
      }

      try {
        await sendGuildEmbedViaWebhook(client, target.id, target.token, validated.payload);
        return void (await message.reply('Embed sent via webhook.'));
      } catch (err) {
        return void (await message.reply(`Failed to send embed: ${messageFromError(err, 'unknown error')}`));
      }
    }

    return void (await message.reply(`Unknown subcommand. Use \`${prefix}embed help\`.`));
  },
};

export default command;
