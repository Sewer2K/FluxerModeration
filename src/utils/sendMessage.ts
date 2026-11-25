import type { DMChannel, Message, MessageSendOptions, TextChannel, UploadFileForSend, User } from '@fluxerjs/core';
import type { RESTPostAPIMessageUploadedAttachment } from '@fluxerjs/types';

type MessageFileData = NonNullable<MessageSendOptions['files']>[number];

type UploadCapable = {
  uploadAttachmentsForSend: (files: UploadFileForSend[]) => Promise<RESTPostAPIMessageUploadedAttachment[]>;
};

type SendCapable = {
  send: (options: MessageSendOptions) => Promise<Message>;
};

export type MessageSendTarget = User | TextChannel | DMChannel | (SendCapable & Partial<UploadCapable>);

function guessContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

function isUploadCapable(value: unknown): value is UploadCapable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'uploadAttachmentsForSend' in value &&
    typeof (value as UploadCapable).uploadAttachmentsForSend === 'function'
  );
}

export function isSendCapable(value: unknown): value is SendCapable {
  return (
    typeof value === 'object' && value !== null && 'send' in value && typeof (value as SendCapable).send === 'function'
  );
}

function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' && value !== null && 'createDM' in value && typeof (value as User).createDM === 'function'
  );
}

function fileName(file: MessageFileData, index: number): string {
  return file.filename ?? file.name ?? `file-${index}`;
}

async function toUploadBuffer(file: MessageFileData): Promise<ArrayBuffer | Uint8Array | Buffer | null> {
  if (!('data' in file)) return null;
  const data = file.data;
  if (data instanceof Blob) return Buffer.from(await data.arrayBuffer());
  return data;
}

async function resolveSendChannel(target: MessageSendTarget | Message): Promise<SendCapable & Partial<UploadCapable>> {
  if (target === null || typeof target !== 'object') {
    throw new Error('Target does not support sending messages');
  }
  if (isUploadCapable(target) && isSendCapable(target)) return target;
  if (isUser(target)) return target.createDM();
  if ('channel' in target && target.channel && isUploadCapable(target.channel) && isSendCapable(target.channel)) {
    return target.channel;
  }
  if ('channelId' in target && target.channelId && 'client' in target && target.client?.channels?.fetch) {
    const fetched = await target.client.channels.fetch(target.channelId);
    if (isSendCapable(fetched)) return fetched;
  }
  if (isSendCapable(target)) return target;
  throw new Error('Target does not support sending messages');
}

export async function withUploadedAttachments(
  target: MessageSendTarget | Message,
  opts: MessageSendOptions,
): Promise<MessageSendOptions> {
  if (!opts.files?.length) return opts;
  if (opts.files.some((f) => !('data' in f))) return opts;

  const channel = await resolveSendChannel(target);
  if (!isUploadCapable(channel)) return opts;

  const { files, ...rest } = opts;
  const prepared: UploadFileForSend[] = [];

  for (const [i, file] of files.entries()) {
    const data = await toUploadBuffer(file);
    if (!data) return opts;
    const filename = fileName(file, i);
    prepared.push({
      id: i,
      filename,
      data,
      contentType: guessContentType(filename),
    });
  }

  const uploadedAttachments = await channel.uploadAttachmentsForSend(prepared);
  return { ...rest, uploadedAttachments };
}

export async function sendMessage(target: MessageSendTarget, opts: MessageSendOptions): Promise<Message> {
  const channel = await resolveSendChannel(target);
  const payload = await withUploadedAttachments(channel, opts);
  return channel.send(payload);
}

export async function replyMessage(message: Message, opts: MessageSendOptions): Promise<Message> {
  const payload = await withUploadedAttachments(message, opts);
  return message.reply(payload);
}

export default sendMessage;
