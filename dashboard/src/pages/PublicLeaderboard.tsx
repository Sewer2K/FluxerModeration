import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Crown, Medal, Trophy } from 'lucide-react';
import {
  fetchPublicLeaderboard,
  guildIconUrl,
  type PublicLeaderboardResponse,
  userAvatarUrl,
} from '../lib/publicLeaderboard';

type Period = 'all' | 'weekly' | 'monthly';

const PERIOD_LABELS: Record<Period, string> = {
  all: 'All time',
  weekly: 'This week',
  monthly: 'This month',
};

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="h-5 w-5 text-amber-400" />;
  if (rank === 2) return <Medal className="h-5 w-5 text-slate-300" />;
  if (rank === 3) return <Trophy className="h-5 w-5 text-orange-400" />;
  return <span className="w-5 text-center text-sm font-semibold text-gray-400">{rank}</span>;
}

export function PublicLeaderboard() {
  const { slug = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const period = (searchParams.get('period') as Period) || 'all';
  const [data, setData] = useState<PublicLeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPublicLeaderboard(slug, period)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setData(null);
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, period]);

  const iconUrl = useMemo(() => (data?.guild ? guildIconUrl(data.guild.id, data.guild.icon, 96) : null), [data]);

  const setPeriod = (next: Period) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('period');
    else params.set('period', next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-gray-200">
      <div className="max-w-3xl mx-auto px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between gap-4 mb-8">
          <Link to="/login" className="text-sm text-gray-400 hover:text-white transition-colors">
            ClaudeCityMod
          </Link>
          <p className="text-xs text-gray-500">Public leaderboard</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-8 text-center">
            <p className="text-lg font-semibold text-white mb-2">Leaderboard unavailable</p>
            <p className="text-sm text-gray-400">{error}</p>
          </div>
        ) : data ? (
          <>
            <div className="flex items-center gap-4 mb-6">
              {iconUrl ? (
                <img src={iconUrl} alt="" className="h-16 w-16 rounded-2xl object-cover border border-white/10" />
              ) : (
                <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold text-white/70">
                  {data.guild.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold text-white">{data.guild.name}</h1>
                <p className="text-sm text-gray-400">Top members by XP</p>
              </div>
            </div>

            <div className="flex gap-2 mb-6">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPeriod(key)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    period === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {PERIOD_LABELS[key]}
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden bg-black/20">
              {data.entries.length === 0 ? (
                <p className="px-5 py-10 text-center text-gray-400">No XP recorded yet.</p>
              ) : (
                <ul className="divide-y divide-[hsl(var(--border))]">
                  {data.entries.map((entry) => {
                    const avatar = userAvatarUrl(entry.userId, entry.avatar, 48);
                    return (
                      <li key={entry.userId} className="flex items-center gap-4 px-4 py-3 sm:px-5">
                        <RankBadge rank={entry.rank} />
                        {avatar ? (
                          <img src={avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold text-white/80">
                            {entry.username.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-white truncate">{entry.username}</p>
                          <p className="text-xs text-gray-500">Level {entry.level}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-white tabular-nums">{entry.xp.toLocaleString()} XP</p>
                          <p className="text-xs text-gray-500">{entry.messages.toLocaleString()} msgs</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : null}

        <p className="text-center text-xs text-gray-600 mt-10">Powered by ClaudeCityMod</p>
      </div>
    </div>
  );
}
