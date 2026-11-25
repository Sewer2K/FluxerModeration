import parseUserId from '@/utils/parseUserId';

export default function resolveTicketUserId(
  mentions: readonly { id: string }[] | null | undefined,
  argument: string | null | undefined,
  content?: string | null,
): string | null {
  const mentionedUserId = mentions?.find((user) => user.id)?.id;
  if (mentionedUserId) return mentionedUserId;

  const fromArgument = parseUserId(argument);
  if (fromArgument) return fromArgument;

  return parseUserId(content);
}
