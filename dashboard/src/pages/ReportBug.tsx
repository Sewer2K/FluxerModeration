import { useEffect, useState, type FormEvent } from 'react';
import { Bug, CheckCircle2, ExternalLink, Loader2, Send } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api, type BugReport, type GuildSummary } from '../lib/api';
import { fluxerAvatarUrl } from '../lib/cdn';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';

const MOCK_MODE = import.meta.env.VITE_MOCK_MODE === 'true';

const MOCK_GUILDS: GuildSummary[] = [
  { id: '300000000000000101', name: 'ClaudeCityMod Test Server', icon: null, botPresent: true },
  { id: '300000000000000102', name: 'Community Sandbox', icon: null, botPresent: true },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

export function ReportBug() {
  const { user } = useAuth();
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [guildId, setGuildId] = useState('');
  const [description, setDescription] = useState('');
  const [links, setLinks] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<BugReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = MOCK_MODE
      ? Promise.resolve(MOCK_GUILDS)
      : api.get<GuildSummary[]>('/reports/context', { skipCache: true });
    load
      .then((nextGuilds) => {
        if (cancelled) return;
        setGuilds(nextGuilds);
        setGuildId((current) => current || nextGuilds[0]?.id || '');
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const report = MOCK_MODE
        ? ({
            _id: 'mock-report-000000000000',
            reporterId: user?.id ?? '300000000000000001',
            reporterUsername: user?.username ?? 'MockAdmin',
            reporterAvatar: user?.avatar ?? null,
            guildId,
            guildName: guilds.find((guild) => guild.id === guildId)?.name ?? 'ClaudeCityMod Test Server',
            description,
            links: links
              .split(/\r?\n/)
              .map((link) => link.trim())
              .filter(Boolean),
            status: 'open',
            replies: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as BugReport)
        : await api.post<BugReport>('/reports', { guildId, description, links });
      setSuccess(report);
      setDescription('');
      setLinks('');
    } catch (submitError: unknown) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Bug className="h-6 w-6 text-blue-400" /> Report a bug
        </h1>
        <p className="text-gray-400 mt-1">Tell me what broke so I can reproduce it and fix it.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your report will include</CardTitle>
          <CardDescription>
            ClaudeCityMod attaches your Fluxer account and the affected server automatically. You do not need to type either
            one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-white/[0.03] p-3">
            {user?.avatar ? (
              <img
                src={fluxerAvatarUrl(user.id, user.avatar) ?? ''}
                alt={user.username}
                className="h-9 w-9 rounded-full"
              />
            ) : (
              <div className="h-9 w-9 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-300 font-semibold">
                {user?.username?.charAt(0).toUpperCase() || '?'}
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-white">{user?.username}</p>
              <p className="text-xs text-gray-500">Fluxer user ID: {user?.id}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What happened?</CardTitle>
          <CardDescription>Include what you expected, what you saw, and the steps that caused it.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="affected-server" className="text-gray-200">
                Affected server
              </Label>
              {loading ? (
                <div className="h-9 flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading your servers...
                </div>
              ) : guilds.length > 0 ? (
                <Select value={guildId} onValueChange={setGuildId}>
                  <SelectTrigger id="affected-server">
                    <SelectValue placeholder="Choose a server" />
                  </SelectTrigger>
                  <SelectContent>
                    {guilds.map((guild) => (
                      <SelectItem key={guild.id} value={guild.id}>
                        {guild.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-yellow-400">
                  ClaudeCityMod was not found in any server you share with this account.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="bug-description" className="text-gray-200">
                Description
              </Label>
              <Textarea
                id="bug-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Example: The dashboard shows ClaudeCityMod as offline, but commands still work in my server."
                rows={8}
                maxLength={5000}
                required
              />
              <p className="text-xs text-gray-500 text-right">{description.length}/5000</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bug-links" className="text-gray-200">
                Screenshots, videos, or other links
              </Label>
              <Textarea
                id="bug-links"
                value={links}
                onChange={(event) => setLinks(event.target.value)}
                placeholder="https://files.catbox.moe/example.png"
                rows={4}
              />
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-sm text-blue-200 space-y-1">
                <p>
                  Good options are{' '}
                  <a href="https://catbox.moe/" target="_blank" rel="noreferrer" className="underline">
                    Catbox
                  </a>{' '}
                  for longer-lived links,{' '}
                  <a href="https://litterbox.catbox.moe/" target="_blank" rel="noreferrer" className="underline">
                    Litterbox
                  </a>{' '}
                  for temporary links,{' '}
                  <a href="https://filebin.net/" target="_blank" rel="noreferrer" className="underline">
                    Filebin
                  </a>{' '}
                  for six-day links, or{' '}
                  <a href="https://wetransfer.com/" target="_blank" rel="noreferrer" className="underline">
                    WeTransfer
                  </a>{' '}
                  for larger files. You can also use{' '}
                  <a
                    href="https://drive.google.com/drive/my-drive"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Google Drive
                  </a>{' '}
                  or{' '}
                  <a href="https://www.dropbox.com/home" target="_blank" rel="noreferrer" className="underline">
                    Dropbox
                  </a>{' '}
                  with link access set to Viewer.
                </p>
                <p className="text-blue-200/70">
                  Paste direct HTTPS links, one per line. ClaudeCityMod does not upload or fetch these files.
                </p>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-300">{error}</div>
            )}

            {success && (
              <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-300">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-medium">Report sent.</p>
                    <p className="mt-1 text-green-300/80">
                      I have the server, your Fluxer account, and the details you entered. Keep the report ID if you
                      need to refer to it: <span className="font-mono">{success._id}</span>
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={submitting || loading || !guildId || !description.trim()}>
                {submitting ? <Loader2 className="animate-spin" /> : <Send />}
                Send report
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-gray-500 flex items-center gap-1">
        <ExternalLink className="h-3 w-3" /> Do not include passwords, tokens, or other private information in a report.
      </p>
    </div>
  );
}
