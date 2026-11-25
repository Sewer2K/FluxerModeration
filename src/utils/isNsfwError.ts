// potentially deprecated but i'm not sure so i'm leaving it in
export default function isNsfwError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && 'code' in error && error.code === 'NSFW_CONTENT_AGE_RESTRICTED') return true;

  const msg =
    typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message.toLowerCase()
      : '';

  return msg.includes('nsfw') && msg.includes('age restricted');
}
