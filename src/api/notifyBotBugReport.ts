import config from '@/config';

interface BugReportReplyResponse {
  ok?: boolean;
  error?: string;
}

export async function sendBugReportReply(
  userId: string,
  reportId: string,
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = config.api.adminToken;
  if (!token) return { ok: false, error: 'Bot communication is not configured' };

  const base = config.bot.internalUrl.replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/internal/bug-report-reply`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, reportId, message }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => ({}))) as BugReportReplyResponse;
    if (!response.ok || body.ok !== true) {
      return { ok: false, error: body.error || 'The bot could not send the Fluxer DM' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'The bot process could not be reached' };
  }
}
