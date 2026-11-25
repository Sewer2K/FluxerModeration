import { useEffect, useState, type FormEvent } from 'react';
import { Bug, Check, Clock3, Loader2, Mail, RefreshCw, Send, UserRound } from 'lucide-react';
import { api, type BugReport, type BugReportReply, type BugReportStatus } from '../lib/api';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';

const MOCK_MODE = import.meta.env.VITE_MOCK_MODE === 'true';

const STATUS_LABELS: Record<BugReportStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

const MOCK_REPORTS: BugReport[] = [
  {
    _id: '65f000000000000000000001',
    reporterId: '300000000000000201',
    reporterUsername: 'pixelpilot',
    reporterAvatar: null,
    guildId: '300000000000000101',
    guildName: 'ClaudeCityMod Test Server',
    description:
      'The dashboard says ClaudeCityMod is offline after a restart, but the bot responds to commands in the server. The status changes back after I refresh twice.',
    links: ['https://files.catbox.moe/status-example.png'],
    status: 'open',
    replies: [],
    createdAt: new Date(Date.now() - 1000 * 60 * 28).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 28).toISOString(),
  },
  {
    _id: '65f000000000000000000002',
    reporterId: '300000000000000202',
    reporterUsername: 'moss',
    reporterAvatar: null,
    guildId: '300000000000000102',
    guildName: 'Community Sandbox',
    description: 'Top members on the leveling page show the wrong names for some users.',
    links: ['https://litterbox.catbox.moe/resources/abc123.mp4'],
    status: 'in_progress',
    replies: [
      {
        replyId: 'mock-reply-1',
        authorId: '300000000000000001',
        message: 'I can reproduce this locally. I am checking the member lookup now.',
        deliveryStatus: 'sent',
        deliveryError: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
        deliveredAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
  },
  {
    _id: '65f000000000000000000003',
    reporterId: '300000000000000203',
    reporterUsername: 'river',
    reporterAvatar: null,
    guildId: '300000000000000101',
    guildName: 'ClaudeCityMod Test Server',
    description: 'The report form would not let me attach a video link from my phone.',
    links: [],
    status: 'resolved',
    replies: [
      {
        replyId: 'mock-reply-2',
        authorId: '300000000000000001',
        message: 'This is fixed in the latest dashboard build. Thanks for reporting it.',
        deliveryStatus: 'failed',
        deliveryError: 'The bot process could not be reached',
        createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
        deliveredAt: null,
      },
    ],
    createdAt: new Date(Date.now() - 1000 * 60 * 110).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function statusVariant(status: BugReportStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'open') return 'default';
  if (status === 'resolved') return 'secondary';
  if (status === 'closed') return 'outline';
  return 'destructive';
}

function DeliveryState({ reply }: { reply: BugReportReply }) {
  if (reply.deliveryStatus === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-400">
        <Check className="h-3 w-3" /> DM sent
      </span>
    );
  }
  if (reply.deliveryStatus === 'failed') {
    return <span className="text-xs text-red-400">DM failed: {reply.deliveryError || 'Unknown error'}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-yellow-400">
      <Clock3 className="h-3 w-3" /> Sending
    </span>
  );
}

export function BugReports() {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | BugReportStatus>('all');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = reports.find((report) => report._id === selectedId) ?? null;

  const loadReports = async () => {
    setError(null);
    if (MOCK_MODE) {
      const next = filter === 'all' ? MOCK_REPORTS : MOCK_REPORTS.filter((report) => report.status === filter);
      setReports(next);
      setSelectedId((current) =>
        current && next.some((report) => report._id === current) ? current : (next[0]?._id ?? null),
      );
      setLoading(false);
      return;
    }

    try {
      const query = filter === 'all' ? '' : `?status=${filter}`;
      const result = await api.get<{ reports: BugReport[]; total: number }>(`/reports${query}`, { skipCache: true });
      setReports(result.reports);
      setSelectedId((current) =>
        current && result.reports.some((report) => report._id === current) ? current : (result.reports[0]?._id ?? null),
      );
    } catch (loadError: unknown) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReports();
  }, [filter]);

  const updateSelected = (next: BugReport) => {
    setReports((current) => current.map((report) => (report._id === next._id ? next : report)));
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadReports();
    setRefreshing(false);
  };

  const handleStatusChange = async (status: BugReportStatus) => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = MOCK_MODE
        ? { ...selected, status, updatedAt: new Date().toISOString() }
        : await api.patch<BugReport>(`/reports/${selected._id}`, { status });
      updateSelected(next);
      setNotice(`Marked report as ${STATUS_LABELS[status].toLowerCase()}.`);
    } catch (statusError: unknown) {
      setError(errorMessage(statusError));
    } finally {
      setSaving(false);
    }
  };

  const handleReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !reply.trim()) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const now = new Date().toISOString();
      const nextReply: BugReportReply = {
        replyId: `mock-reply-${Date.now()}`,
        authorId: '300000000000000001',
        message: reply.trim(),
        deliveryStatus: 'sent',
        deliveryError: null,
        createdAt: now,
        deliveredAt: now,
      };
      const result = MOCK_MODE
        ? { report: { ...selected, replies: [...selected.replies, nextReply], updatedAt: now }, deliveryStatus: 'sent' }
        : await api.post<{ report: BugReport; deliveryStatus: BugReportReply['deliveryStatus'] }>(
            `/reports/${selected._id}/replies`,
            { message: reply },
          );
      updateSelected(result.report);
      setReply('');
      setNotice(
        result.deliveryStatus === 'sent' ? 'Reply sent by Fluxer DM.' : 'Reply saved, but the Fluxer DM failed.',
      );
    } catch (replyError: unknown) {
      setError(errorMessage(replyError));
    } finally {
      setSaving(false);
    }
  };

  const handleRetry = async (replyToRetry: BugReportReply) => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const now = new Date().toISOString();
      const nextReply = { ...replyToRetry, deliveryStatus: 'sent' as const, deliveryError: null, deliveredAt: now };
      const result = MOCK_MODE
        ? {
            report: {
              ...selected,
              replies: selected.replies.map((item) => (item.replyId === replyToRetry.replyId ? nextReply : item)),
            },
          }
        : await api.post<{ report: BugReport; deliveryStatus: BugReportReply['deliveryStatus'] }>(
            `/reports/${selected._id}/replies/${replyToRetry.replyId}/retry`,
          );
      updateSelected(result.report);
      setNotice(
        result.report.replies.find((item) => item.replyId === replyToRetry.replyId)?.deliveryStatus === 'sent'
          ? 'Reply delivered by Fluxer DM.'
          : 'The retry failed.',
      );
    } catch (retryError: unknown) {
      setError(errorMessage(retryError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bug className="h-6 w-6 text-blue-400" /> Bug reports
          </h1>
          <p className="text-gray-400 mt-1">Review reports from Fluxer users and reply when you have an update.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-400">Show</span>
        <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All reports</SelectItem>
            {Object.entries(STATUS_LABELS).map(([status, label]) => (
              <SelectItem key={status} value={status}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-300">{notice}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.6fr)] gap-6">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Inbox</CardTitle>
              <CardDescription>
                {reports.length} report{reports.length === 1 ? '' : 's'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {reports.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">Nothing here.</p>
              ) : (
                reports.map((report) => (
                  <button
                    key={report._id}
                    onClick={() => {
                      setSelectedId(report._id);
                      setNotice(null);
                    }}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      selectedId === report._id
                        ? 'border-blue-500/60 bg-blue-500/10'
                        : 'border-[hsl(var(--border))] hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-white truncate">{report.reporterUsername}</p>
                      <Badge variant={statusVariant(report.status)}>{STATUS_LABELS[report.status]}</Badge>
                    </div>
                    <p className="text-xs text-blue-300 mt-1 truncate">{report.guildName}</p>
                    <p className="text-xs text-gray-400 mt-2 line-clamp-2">{report.description}</p>
                    <p className="text-[11px] text-gray-600 mt-2">{formatDate(report.createdAt)}</p>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {selected ? (
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <UserRound className="h-5 w-5 text-blue-400" /> {selected.reporterUsername}
                    </CardTitle>
                    <CardDescription className="mt-2 space-y-1">
                      <span className="block">User ID: {selected.reporterId}</span>
                      <span className="block">
                        Server: {selected.guildName} ({selected.guildId})
                      </span>
                      <span className="block">Reported {formatDate(selected.createdAt)}</span>
                    </CardDescription>
                  </div>
                  <Select
                    value={selected.status}
                    onValueChange={(value) => void handleStatusChange(value as BugReportStatus)}
                    disabled={saving}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([status, label]) => (
                        <SelectItem key={status} value={status}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h2 className="text-sm font-semibold text-gray-200 mb-2">Report</h2>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap rounded-lg bg-white/[0.03] border border-[hsl(var(--border))] p-4">
                    {selected.description}
                  </p>
                </div>

                {selected.links.length > 0 && (
                  <div>
                    <h2 className="text-sm font-semibold text-gray-200 mb-2">External links</h2>
                    <ul className="space-y-2">
                      {selected.links.map((link) => (
                        <li key={link}>
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-blue-400 hover:underline break-all"
                          >
                            {link}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <h2 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
                    <Mail className="h-4 w-4" /> Reply history
                  </h2>
                  {selected.replies.length === 0 ? (
                    <p className="text-sm text-gray-500">No replies yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {selected.replies.map((item) => (
                        <div key={item.replyId} className="rounded-lg border border-[hsl(var(--border))] p-3">
                          <p className="text-sm text-gray-300 whitespace-pre-wrap">{item.message}</p>
                          <div className="flex flex-wrap items-center gap-3 mt-3">
                            <span className="text-xs text-gray-500">{formatDate(item.createdAt)}</span>
                            <DeliveryState reply={item} />
                            {item.deliveryStatus === 'failed' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleRetry(item)}
                                disabled={saving}
                              >
                                Retry DM
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <form onSubmit={handleReply} className="space-y-3 border-t border-[hsl(var(--border))] pt-5">
                  <label htmlFor="report-reply" className="text-sm font-semibold text-gray-200">
                    Send a reply by Fluxer DM
                  </label>
                  <Textarea
                    id="report-reply"
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder="Tell the reporter what you found or fixed."
                    rows={5}
                    maxLength={4000}
                  />
                  <div className="flex justify-end">
                    <Button type="submit" disabled={saving || !reply.trim()}>
                      {saving ? <Loader2 className="animate-spin" /> : <Send />} Send reply
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-20 text-center text-gray-400">Select a report to inspect it.</CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
