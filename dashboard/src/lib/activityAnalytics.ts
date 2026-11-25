import type { GuildActivityChannel, GuildActivityDaily, GuildActivityHeatmapCell } from './api';

export const ACTIVITY_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type ActivityViewState = 'loading' | 'empty' | 'populated';

export function getActivityViewState(
  daily: GuildActivityDaily[],
  channels: GuildActivityChannel[],
  heatmap: GuildActivityHeatmapCell[],
  loading = false,
): ActivityViewState {
  if (loading) return 'loading';
  const hasDailyActivity = daily.some(
    (point) =>
      point.messages > 0 ||
      point.joins > 0 ||
      point.leaves > 0 ||
      point.voiceJoins > 0 ||
      point.moderationActions > 0 ||
      point.automodActions > 0 ||
      point.tickets > 0 ||
      point.reports > 0,
  );
  return hasDailyActivity || channels.length > 0 || heatmap.some((cell) => cell.count > 0) ? 'populated' : 'empty';
}

export function getHeatmapIntensity(count: number, maximum: number): number {
  if (count <= 0 || maximum <= 0) return 0;
  return Math.min(1, count / maximum);
}
