import { useEffect, useState, useCallback } from 'react';
import {
  api,
  type GuildAnalyticsSummary,
  type GuildDailyStat,
  type GuildTopCommand,
  type GuildModDaily,
  type GuildModBreakdown,
  type GuildMemberTrend,
  type GuildLevelingEntry,
  type GuildActivityDaily,
  type GuildActivitySummary,
  type GuildActivityChannel,
  type GuildActivityHeatmapResponse,
} from '../lib/api';
import { ACTIVITY_WEEKDAYS, getActivityViewState, getHeatmapIntensity } from '../lib/activityAnalytics';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import {
  Terminal,
  Gavel,
  Users,
  Award,
  MessageSquare,
  TrendingUp,
  Download,
  BarChart3,
  Activity,
  Mic,
  ShieldAlert,
  Clock,
  Hash,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const tooltipStyle = {
  backgroundColor: 'hsl(222.2, 84%, 6%)',
  border: '1px solid hsl(217.2, 32.6%, 17.5%)',
  borderRadius: '8px',
  color: '#fff',
};

const gridStroke = 'hsl(217.2, 32.6%, 17.5%)';

const PIE_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#6366f1',
  '#14b8a6',
];

function formatDate(v: string | number) {
  return new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface GuildAnalyticsProps {
  guildId: string;
}

export default function GuildAnalytics({ guildId }: GuildAnalyticsProps) {
  const [summary, setSummary] = useState<GuildAnalyticsSummary | null>(null);
  const [commandsDaily, setCommandsDaily] = useState<GuildDailyStat[]>([]);
  const [topCommands, setTopCommands] = useState<GuildTopCommand[]>([]);
  const [modDaily, setModDaily] = useState<GuildModDaily[]>([]);
  const [modBreakdown, setModBreakdown] = useState<GuildModBreakdown | null>(null);
  const [memberTrend, setMemberTrend] = useState<GuildMemberTrend[]>([]);
  const [topLeveling, setTopLeveling] = useState<GuildLevelingEntry[]>([]);
  const [activityDaily, setActivityDaily] = useState<GuildActivityDaily[]>([]);
  const [activitySummary, setActivitySummary] = useState<GuildActivitySummary | null>(null);
  const [activityChannels, setActivityChannels] = useState<GuildActivityChannel[]>([]);
  const [activityHeatmap, setActivityHeatmap] = useState<GuildActivityHeatmapResponse>({
    cells: [],
    lastUpdated: null,
  });
  const [days, setDays] = useState('30');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const base = `/guilds/${guildId}/analytics`;

    Promise.all([
      api.get<GuildAnalyticsSummary>(`${base}/summary`),
      api.get<GuildDailyStat[]>(`${base}/commands/daily?days=${days}`),
      api.get<GuildTopCommand[]>(`${base}/commands/top?limit=10`),
      api.get<GuildModDaily[]>(`${base}/moderation/daily?days=${days}`),
      api.get<GuildModBreakdown>(`${base}/moderation/breakdown?days=${days}`),
      api.get<GuildMemberTrend[]>(`${base}/members/trend?days=${days}`),
      api.get<GuildLevelingEntry[]>(`${base}/leveling/top?limit=10`),
      api.get<{ daily: GuildActivityDaily[]; lastUpdated: string | null }>(`${base}/activity/daily?days=${days}`),
      api.get<GuildActivitySummary>(`${base}/activity/summary?days=${days}`),
      api.get<GuildActivityChannel[]>(`${base}/activity/channels?days=${days}&limit=10`),
      api.get<GuildActivityHeatmapResponse>(`${base}/activity/heatmap?days=${days}`),
    ])
      .then(([s, cd, tc, md, mb, mt, tl, ad, activity, channels, heatmap]) => {
        setSummary(s);
        setCommandsDaily(cd);
        setTopCommands(tc);
        setModDaily(md);
        setModBreakdown(mb);
        setMemberTrend(mt);
        setTopLeveling(tl);
        setActivityDaily(ad.daily);
        setActivitySummary(activity);
        setActivityChannels(channels);
        setActivityHeatmap(heatmap);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [guildId, days]);

  const handleExport = useCallback(() => {
    const url = `/api/guilds/${guildId}/analytics/export?days=${days}`;
    window.open(url, '_blank');
  }, [guildId, days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error) {
    return <div className="text-red-400">Failed to load analytics: {error}</div>;
  }

  const summaryCards = [
    {
      label: 'Members',
      value: summary?.members?.toLocaleString() ?? '0',
      icon: Users,
      color: 'text-blue-400',
    },
    {
      label: 'Commands Used',
      value: summary?.totalCommands?.toLocaleString() ?? '0',
      icon: Terminal,
      color: 'text-green-400',
    },
    {
      label: 'Mod Actions',
      value: summary?.totalModActions?.toLocaleString() ?? '0',
      icon: Gavel,
      color: 'text-red-400',
    },
    {
      label: 'Leveling Messages',
      value: summary?.levelingMessages?.toLocaleString() ?? '0',
      icon: MessageSquare,
      color: 'text-purple-400',
    },
    {
      label: 'Leveling Profiles',
      value: summary?.levelingProfiles?.toLocaleString() ?? '0',
      icon: Award,
      color: 'text-yellow-400',
    },
    {
      label: 'Avg Level',
      value: String(summary?.avgLevel ?? 0),
      icon: TrendingUp,
      color: 'text-cyan-400',
    },
  ];

  const pieData = modBreakdown
    ? Object.entries(modBreakdown.byAction)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Server Analytics</h2>
          <p className="text-sm text-gray-400 mt-0.5">Activity, moderation, and growth data for your server.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="180">Last 180 days</SelectItem>
              <SelectItem value="365">Last 365 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-gray-400">{card.label}</p>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
              <p className="text-xl font-bold text-white">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Server activity */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Activity className="h-5 w-5 text-cyan-400" />
              Server Activity
            </h3>
            <p className="text-sm text-gray-400 mt-0.5">
              General server usage, separate from ClaudeCityMod command and leveling data.
            </p>
          </div>
          {activitySummary?.lastUpdated && (
            <p className="text-xs text-gray-500">Updated {new Date(activitySummary.lastUpdated).toLocaleString()}</p>
          )}
        </div>

        {getActivityViewState(activityDaily, activityChannels, activityHeatmap.cells) === 'empty' ? (
          <Card>
            <CardContent className="py-10 text-center">
              <Activity className="mx-auto h-8 w-8 text-gray-600" />
              <p className="mt-3 text-gray-300">No server activity has been recorded for this period.</p>
              <p className="mt-1 text-sm text-gray-500">Activity data will appear as members use the server.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                {
                  label: 'Messages',
                  value: activitySummary?.messages ?? 0,
                  icon: MessageSquare,
                  color: 'text-blue-400',
                },
                {
                  label: 'Active Members',
                  value: activitySummary?.activeMembers ?? 0,
                  icon: Users,
                  color: 'text-cyan-400',
                },
                { label: 'Joins', value: activitySummary?.joins ?? 0, icon: Users, color: 'text-green-400' },
                { label: 'Leaves', value: activitySummary?.leaves ?? 0, icon: Users, color: 'text-orange-400' },
                {
                  label: 'Voice Minutes',
                  value: Math.round(activitySummary?.voiceMinutes ?? 0),
                  icon: Mic,
                  color: 'text-purple-400',
                },
                {
                  label: 'Moderation',
                  value: activitySummary?.moderationActions ?? 0,
                  icon: ShieldAlert,
                  color: 'text-red-400',
                },
              ].map((card) => (
                <Card key={card.label}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-gray-400">{card.label}</p>
                      <card.icon className={`h-4 w-4 ${card.color}`} />
                    </div>
                    <p className="text-xl font-bold text-white">{card.value.toLocaleString()}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-blue-400" />
                    Messages and Active Members
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={activityDaily}>
                      <defs>
                        <linearGradient id="colorActivityMessages" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorActivityMembers" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="date" stroke="#6b7280" fontSize={12} tickFormatter={formatDate} />
                      <YAxis stroke="#6b7280" fontSize={12} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Area
                        type="monotone"
                        dataKey="messages"
                        name="Messages"
                        stroke="#3b82f6"
                        fill="url(#colorActivityMessages)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="activeMembers"
                        name="Active members"
                        stroke="#06b6d4"
                        fill="url(#colorActivityMembers)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-green-400" />
                    Joins and Leaves
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={activityDaily}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="date" stroke="#6b7280" fontSize={12} tickFormatter={formatDate} />
                      <YAxis stroke="#6b7280" fontSize={12} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="joins" name="Joins" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="leaves" name="Leaves" fill="#f97316" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-yellow-400" />
                    Activity by Day and Hour
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <div className="min-w-[560px]">
                      <div className="grid grid-cols-[48px_repeat(24,minmax(16px,1fr))] gap-1 text-[10px] text-gray-500">
                        <span />
                        {Array.from({ length: 24 }, (_, hour) => (
                          <span key={hour} className="text-center">
                            {hour}
                          </span>
                        ))}
                        {ACTIVITY_WEEKDAYS.map((day, weekday) => (
                          <div key={day} className="contents">
                            <span className="pr-1 text-right leading-4">{day}</span>
                            {Array.from({ length: 24 }, (_, hour) => {
                              const cell = activityHeatmap.cells.find(
                                (candidate) => candidate.weekday === weekday && candidate.hour === hour,
                              );
                              const maximum = Math.max(...activityHeatmap.cells.map((candidate) => candidate.count), 0);
                              const intensity = getHeatmapIntensity(cell?.count ?? 0, maximum);
                              return (
                                <span
                                  key={`${weekday}-${hour}`}
                                  title={`${day} ${hour}:00, ${cell?.count ?? 0} messages`}
                                  className="aspect-square rounded-sm"
                                  style={{
                                    backgroundColor:
                                      intensity === 0
                                        ? 'hsl(217.2 32.6% 17.5%)'
                                        : `rgba(6, 182, 212, ${0.2 + intensity * 0.8})`,
                                  }}
                                />
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-blue-400" />
                    Top Active Channels
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {activityChannels.length === 0 ? (
                    <p className="text-gray-400 text-center py-8">No channel activity for this period.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart
                        data={activityChannels.map((channel) => ({
                          ...channel,
                          name: channel.channelName ? `#${channel.channelName}` : `#${channel.channelId}`,
                        }))}
                        layout="vertical"
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                        <XAxis type="number" stroke="#6b7280" fontSize={12} />
                        <YAxis type="category" dataKey="name" stroke="#6b7280" fontSize={12} width={110} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="count" name="Messages" fill="#06b6d4" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-red-400" />
                  Voice and Safety Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={activityDaily}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="date" stroke="#6b7280" fontSize={12} tickFormatter={formatDate} />
                    <YAxis stroke="#6b7280" fontSize={12} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="voiceJoins" name="Voice joins" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="moderationActions" name="Moderation" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="automodActions" name="Automod" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </>
        )}
      </section>

      {/* Command usage chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-green-400" />
            Command Usage
          </CardTitle>
        </CardHeader>
        <CardContent>
          {commandsDaily.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No command data for this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={commandsDaily}>
                <defs>
                  <linearGradient id="colorGuildCmds" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="date" stroke="#6b7280" fontSize={12} tickFormatter={formatDate} />
                <YAxis stroke="#6b7280" fontSize={12} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(v) => new Date(v as string | number).toLocaleDateString()}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="Commands"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorGuildCmds)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top commands */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-400" />
              Top Commands
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topCommands.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topCommands} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis type="number" stroke="#6b7280" fontSize={12} />
                  <YAxis type="category" dataKey="command" stroke="#6b7280" fontSize={12} width={90} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Uses" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Moderation action breakdown (pie) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gavel className="h-4 w-4 text-red-400" />
              Moderation Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No moderation actions in this period.</p>
            ) : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                      fontSize={11}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <p className="text-sm text-gray-400 mt-1">{modBreakdown?.total ?? 0} total actions</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Moderation daily */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gavel className="h-4 w-4 text-red-400" />
            Daily Moderation Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {modDaily.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No moderation data for this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={modDaily}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="date" stroke="#6b7280" fontSize={12} tickFormatter={formatDate} />
                <YAxis stroke="#6b7280" fontSize={12} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(v) => new Date(v as string | number).toLocaleDateString()}
                />
                <Bar dataKey="total" name="Actions" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Member trend */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-400" />
            Member Count Over Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          {memberTrend.length === 0 ? (
            <p className="text-gray-400 text-center py-8">Member tracking started. Check back in a day or two.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={memberTrend}>
                <defs>
                  <linearGradient id="colorGuildMembers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="date" stroke="#6b7280" fontSize={12} tickFormatter={formatDate} />
                <YAxis stroke="#6b7280" fontSize={12} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(v) => new Date(v as string | number).toLocaleDateString()}
                />
                <Area
                  type="monotone"
                  dataKey="members"
                  name="Members"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorGuildMembers)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Top leveling users */}
      {topLeveling.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-4 w-4 text-yellow-400" />
              Top Members (Leveling)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {topLeveling.map((entry, i) => (
                <div key={entry.userId} className="flex items-center gap-3">
                  <span className="text-sm font-mono text-gray-500 w-6 text-right">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <div className="h-2 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-yellow-500"
                        style={{ width: `${(entry.xp / (topLeveling[0]?.xp || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span
                    className="text-sm text-gray-300 truncate w-32"
                    title={`${entry.username || entry.userId} (${entry.userId})`}
                  >
                    {entry.username || entry.userId}
                  </span>
                  <span className="text-xs text-gray-500 w-12 text-right">Lv {entry.level}</span>
                  <span className="text-sm font-semibold text-white w-16 text-right">
                    {entry.xp.toLocaleString()} XP
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
