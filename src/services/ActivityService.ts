import ActivityDaily from '@/models/ActivityDaily';

const FLUSH_INTERVAL_MS = 15_000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

type CounterName =
  | 'messages'
  | 'commands'
  | 'joins'
  | 'leaves'
  | 'voiceJoins'
  | 'voiceMinutes'
  | 'moderationActions'
  | 'automodActions'
  | 'tickets'
  | 'reports';

interface PendingActivity {
  guildId: string;
  date: string;
  counters: Record<CounterName, number>;
  activeUsers: Set<string>;
  channels: Map<string, number>;
  hours: number[];
}

export interface ActivityDailyPoint {
  date: string;
  messages: number;
  commands: number;
  activeMembers: number;
  joins: number;
  leaves: number;
  voiceJoins: number;
  voiceMinutes: number;
  moderationActions: number;
  automodActions: number;
  tickets: number;
  reports: number;
}

export interface ActivitySummary {
  messages: number;
  commands: number;
  activeMembers: number;
  joins: number;
  leaves: number;
  voiceJoins: number;
  voiceMinutes: number;
  moderationActions: number;
  automodActions: number;
  tickets: number;
  reports: number;
  lastUpdated: string | null;
}

export interface ActivityChannelTotal {
  channelId: string;
  count: number;
}

export interface ActivityHeatmapCell {
  weekday: number;
  hour: number;
  count: number;
}

interface StoredActivityBucket {
  date: string;
  [key: string]: unknown;
  hours?: Record<string, number> | Map<string, number>;
  updatedAt?: Date | string;
}

function utcDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function emptyCounters(): Record<CounterName, number> {
  return {
    messages: 0,
    commands: 0,
    joins: 0,
    leaves: 0,
    voiceJoins: 0,
    voiceMinutes: 0,
    moderationActions: 0,
    automodActions: 0,
    tickets: 0,
    reports: 0,
  };
}

function emptyPending(guildId: string, date: string): PendingActivity {
  return {
    guildId,
    date,
    counters: emptyCounters(),
    activeUsers: new Set(),
    channels: new Map(),
    hours: Array.from({ length: 24 }, () => 0),
  };
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function valueFromMap(value: Record<string, number> | Map<string, number> | undefined, key: string): number {
  if (!value) return 0;
  if (value instanceof Map) return numberValue(value.get(key));
  return numberValue(value[key]);
}

function updatedAtValue(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function isSafeMongoKey(value: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

function addToMap(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function mergePending(target: PendingActivity, source: PendingActivity): void {
  for (const name of Object.keys(target.counters) as CounterName[]) {
    target.counters[name] += source.counters[name];
  }
  for (const userId of source.activeUsers) target.activeUsers.add(userId);
  for (const [channelId, count] of source.channels) addToMap(target.channels, channelId, count);
  for (let hour = 0; hour < target.hours.length; hour++) {
    target.hours[hour] = (target.hours[hour] ?? 0) + (source.hours[hour] ?? 0);
  }
}

export class ActivityService {
  private readonly pending = new Map<string, PendingActivity>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private flushInFlight: Promise<void> | null = null;

  start(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();

    this.cleanupTimer = setInterval(() => {
      void this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    await this.flush();
  }

  recordMessage(guildId: string, userId: string, channelId?: string | null, at = new Date()): void {
    const bucket = this.getBucket(guildId, at);
    bucket.counters.messages++;
    bucket.activeUsers.add(userId);
    bucket.hours[at.getUTCHours()] = (bucket.hours[at.getUTCHours()] ?? 0) + 1;
    if (channelId && isSafeMongoKey(channelId)) addToMap(bucket.channels, channelId, 1);
  }

  recordCommand(guildId: string, userId?: string, at = new Date()): void {
    const bucket = this.getBucket(guildId, at);
    bucket.counters.commands++;
    if (userId) bucket.activeUsers.add(userId);
  }

  recordMemberJoin(guildId: string, at = new Date()): void {
    this.getBucket(guildId, at).counters.joins++;
  }

  recordMemberLeave(guildId: string, at = new Date()): void {
    this.getBucket(guildId, at).counters.leaves++;
  }

  recordVoiceJoin(guildId: string, at = new Date()): void {
    this.getBucket(guildId, at).counters.voiceJoins++;
  }

  recordVoiceMinutes(guildId: string, minutes: number, at = new Date()): void {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    this.getBucket(guildId, at).counters.voiceMinutes += minutes;
  }

  recordModerationAction(guildId: string, at = new Date()): void {
    this.getBucket(guildId, at).counters.moderationActions++;
  }

  recordAutomodAction(guildId: string, at = new Date()): void {
    this.getBucket(guildId, at).counters.automodActions++;
  }

  recordTicket(guildId: string, at = new Date()): void {
    this.getBucket(guildId, at).counters.tickets++;
  }

  recordReport(guildId: string, at = new Date()): void {
    this.getBucket(guildId, at).counters.reports++;
  }

  getPendingBucketCount(): number {
    return this.pending.size;
  }

  async flush(): Promise<void> {
    if (this.flushInFlight) return this.flushInFlight;
    this.flushInFlight = this.flushPending();
    try {
      await this.flushInFlight;
    } finally {
      this.flushInFlight = null;
    }
  }

  async cleanup(retentionDays = RETENTION_DAYS): Promise<number> {
    const cutoff = utcDate(new Date(Date.now() - retentionDays * DAY_MS));
    const result = await ActivityDaily.deleteMany({ date: { $lt: cutoff } });
    return result.deletedCount;
  }

  async getDaily(guildId: string, days = 30): Promise<{ daily: ActivityDailyPoint[]; lastUpdated: string | null }> {
    const buckets = await this.findBuckets(
      guildId,
      days,
      'date messages commands activeMembers joins leaves voiceJoins voiceMinutes moderationActions automodActions tickets reports updatedAt',
    );
    const daily = buckets.map((bucket) => this.toDailyPoint(bucket));
    return { daily, lastUpdated: this.latestUpdate(buckets) };
  }

  async getSummary(guildId: string, days = 30): Promise<ActivitySummary> {
    const { daily, lastUpdated } = await this.getDaily(guildId, days);
    const summary: ActivitySummary = {
      messages: 0,
      commands: 0,
      activeMembers: 0,
      joins: 0,
      leaves: 0,
      voiceJoins: 0,
      voiceMinutes: 0,
      moderationActions: 0,
      automodActions: 0,
      tickets: 0,
      reports: 0,
      lastUpdated,
    };

    for (const point of daily) {
      summary.messages += point.messages;
      summary.commands += point.commands;
      summary.activeMembers = Math.max(summary.activeMembers, point.activeMembers);
      summary.joins += point.joins;
      summary.leaves += point.leaves;
      summary.voiceJoins += point.voiceJoins;
      summary.voiceMinutes += point.voiceMinutes;
      summary.moderationActions += point.moderationActions;
      summary.automodActions += point.automodActions;
      summary.tickets += point.tickets;
      summary.reports += point.reports;
    }

    return summary;
  }

  async getTopChannels(guildId: string, days = 30, limit = 10): Promise<ActivityChannelTotal[]> {
    const since = utcDate(new Date(Date.now() - Math.max(days - 1, 0) * DAY_MS));
    const rows = await ActivityDaily.aggregate<{ _id: string; count: number }>([
      { $match: { guildId, date: { $gte: since } } },
      { $project: { channels: { $objectToArray: '$channels' } } },
      { $unwind: '$channels' },
      { $group: { _id: '$channels.k', count: { $sum: '$channels.v' } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
    ]);

    return rows.map((row) => ({ channelId: row._id, count: row.count }));
  }

  async getHeatmap(guildId: string, days = 30): Promise<{ cells: ActivityHeatmapCell[]; lastUpdated: string | null }> {
    const buckets = await this.findBuckets(guildId, days, 'date hours updatedAt');
    const counts = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

    for (const bucket of buckets) {
      const weekday = new Date(`${bucket.date}T00:00:00.000Z`).getUTCDay();
      const row = counts[weekday];
      if (!row) continue;
      for (let hour = 0; hour < 24; hour++) {
        row[hour] = (row[hour] ?? 0) + valueFromMap(bucket.hours, String(hour));
      }
    }

    const cells: ActivityHeatmapCell[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      for (let hour = 0; hour < 24; hour++) {
        cells.push({ weekday, hour, count: counts[weekday]![hour] ?? 0 });
      }
    }

    return { cells, lastUpdated: this.latestUpdate(buckets) };
  }

  private getBucket(guildId: string, at: Date): PendingActivity {
    const date = utcDate(at);
    const key = `${guildId}:${date}`;
    let bucket = this.pending.get(key);
    if (!bucket) {
      bucket = emptyPending(guildId, date);
      this.pending.set(key, bucket);
    }
    return bucket;
  }

  private async flushPending(): Promise<void> {
    const entries = [...this.pending.entries()];
    for (const [key, bucket] of entries) {
      if (this.pending.get(key) === bucket) this.pending.delete(key);

      try {
        await this.flushBucket(bucket);
      } catch (error) {
        const current = this.pending.get(key);
        if (current) {
          mergePending(current, bucket);
        } else {
          this.pending.set(key, bucket);
        }
        console.error('[ActivityService] Failed to flush activity:', error);
      }
    }
  }

  private async flushBucket(bucket: PendingActivity): Promise<void> {
    const increment: Record<string, number> = {};
    for (const [name, count] of Object.entries(bucket.counters)) {
      if (count > 0) increment[name] = count;
    }
    for (const [channelId, count] of bucket.channels) {
      increment[`channels.${channelId}`] = count;
    }
    for (const [hour, count] of bucket.hours.entries()) {
      if (count > 0) increment[`hours.${hour}`] = count;
    }

    if (Object.keys(increment).length === 0) return;

    await ActivityDaily.findOneAndUpdate(
      { guildId: bucket.guildId, date: bucket.date },
      {
        $setOnInsert: { guildId: bucket.guildId, date: bucket.date },
        $inc: increment,
        $max: { activeMembers: bucket.activeUsers.size },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  private async findBuckets(guildId: string, days: number, select: string): Promise<StoredActivityBucket[]> {
    const since = utcDate(new Date(Date.now() - Math.max(days - 1, 0) * DAY_MS));
    const buckets = await ActivityDaily.find({ guildId, date: { $gte: since } })
      .select(select)
      .sort({ date: 1 })
      .lean();
    return buckets as unknown as StoredActivityBucket[];
  }

  private toDailyPoint(bucket: StoredActivityBucket): ActivityDailyPoint {
    return {
      date: bucket.date,
      messages: numberValue(bucket.messages),
      commands: numberValue(bucket.commands),
      activeMembers: numberValue(bucket.activeMembers),
      joins: numberValue(bucket.joins),
      leaves: numberValue(bucket.leaves),
      voiceJoins: numberValue(bucket.voiceJoins),
      voiceMinutes: numberValue(bucket.voiceMinutes),
      moderationActions: numberValue(bucket.moderationActions),
      automodActions: numberValue(bucket.automodActions),
      tickets: numberValue(bucket.tickets),
      reports: numberValue(bucket.reports),
    };
  }

  private latestUpdate(buckets: StoredActivityBucket[]): string | null {
    return buckets.reduce<string | null>((latest, bucket) => {
      const updatedAt = updatedAtValue(bucket.updatedAt);
      if (!updatedAt || (latest && latest >= updatedAt)) return latest;
      return updatedAt;
    }, null);
  }
}

const activityService = new ActivityService();
export default activityService;
