import Stat from '@/models/Stat';

export class StatsService {
  async recordCommand(commandName: string, guildId?: string, userId?: string): Promise<void> {
    try {
      await Stat.create({
        type: 'command',
        value: commandName,
        additionalData: { guildId, userId },
      });
    } catch (err) {
      console.error('[StatsService] Failed to record command:', err);
    }
  }

  async recordGuildJoin(guildId: string, guildName: string): Promise<void> {
    try {
      await Stat.create({
        type: 'guild_join',
        value: guildId,
        additionalData: { guildName },
      });
    } catch (err) {
      console.error('[StatsService] Failed to record guild join:', err);
    }
  }

  async recordGuildLeave(guildId: string, guildName: string): Promise<void> {
    try {
      await Stat.create({
        type: 'guild_leave',
        value: guildId,
        additionalData: { guildName },
      });
    } catch (err) {
      console.error('[StatsService] Failed to record guild leave:', err);
    }
  }

  async getCommandCount(days = 30): Promise<number> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return Stat.countDocuments({ type: 'command', createdAt: { $gte: since } });
  }

  async getDailyCommandCounts(days = 30): Promise<Array<{ date: string; count: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const daily = await Stat.aggregate([
      { $match: { type: 'command', createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return daily.map((d) => ({ date: d._id, count: d.count }));
  }

  async getTopCommands(limit = 10): Promise<Array<{ command: string; count: number }>> {
    const top = await Stat.aggregate([
      { $match: { type: 'command' } },
      { $group: { _id: '$value', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);

    return top.map((t) => ({ command: t._id, count: t.count }));
  }

  async recordGuildSnapshot(guildCount: number, memberCount: number): Promise<void> {
    try {
      await Stat.create({
        type: 'guild_snapshot',
        value: String(guildCount),
        additionalData: { memberCount },
      });
    } catch (err) {
      console.error('[StatsService] Failed to record guild snapshot:', err);
    }
  }

  async getGuildGrowth(days = 30): Promise<Array<{ date: string; guilds: number; members: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const snapshots = await Stat.aggregate<{ _id: string; guilds: number; members: number }>([
      { $match: { type: 'guild_snapshot', createdAt: { $gte: since } } },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          guilds: { $last: { $toInt: '$value' } },
          members: { $last: '$additionalData.memberCount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return snapshots.map((s) => ({
      date: s._id,
      guilds: s.guilds,
      members: typeof s.members === 'number' ? s.members : 0,
    }));
  }

  async getDailyGuildEvents(days = 30): Promise<{
    daily: Array<{ date: string; joins: number; leaves: number }>;
    totals: { joins: number; leaves: number };
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const events = await Stat.aggregate<{ _id: { date: string; type: string }; count: number }>([
      { $match: { type: { $in: ['guild_join', 'guild_leave'] }, createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            type: '$type',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.date': 1 } },
    ]);

    const byDate = new Map<string, { joins: number; leaves: number }>();
    let totalJoins = 0;
    let totalLeaves = 0;

    for (const e of events) {
      const entry = byDate.get(e._id.date) ?? { joins: 0, leaves: 0 };
      if (e._id.type === 'guild_join') {
        entry.joins = e.count;
        totalJoins += e.count;
      } else {
        entry.leaves = e.count;
        totalLeaves += e.count;
      }
      byDate.set(e._id.date, entry);
    }

    const daily = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));

    return { daily, totals: { joins: totalJoins, leaves: totalLeaves } };
  }

  async recordGuildMemberSnapshot(guildId: string, memberCount: number): Promise<void> {
    try {
      await Stat.create({
        type: 'guild_member_snapshot',
        value: guildId,
        additionalData: { memberCount },
      });
    } catch (err) {
      console.error('[StatsService] Failed to record guild member snapshot:', err);
    }
  }

  async getLatestGuildMemberCount(guildId: string): Promise<number | null> {
    const snapshot = await Stat.findOne({
      type: 'guild_member_snapshot',
      value: guildId,
    })
      .sort({ createdAt: -1 })
      .lean();
    const count = snapshot?.additionalData?.memberCount;
    return typeof count === 'number' ? count : null;
  }

  async getGuildCommandsDaily(guildId: string, days = 30): Promise<Array<{ date: string; count: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const daily = await Stat.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          type: 'command',
          'additionalData.guildId': guildId,
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return daily.map((d) => ({ date: d._id, count: d.count }));
  }

  async getGuildTopCommands(guildId: string, limit = 10): Promise<Array<{ command: string; count: number }>> {
    const top = await Stat.aggregate<{ _id: string; count: number }>([
      { $match: { type: 'command', 'additionalData.guildId': guildId } },
      { $group: { _id: '$value', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);

    return top.map((t) => ({ command: t._id, count: t.count }));
  }

  async getGuildCommandCount(guildId: string, days?: number): Promise<number> {
    const query: Record<string, unknown> = {
      type: 'command',
      'additionalData.guildId': guildId,
    };
    if (days) {
      query.createdAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
    }
    return Stat.countDocuments(query);
  }

  async getGuildMemberTrend(guildId: string, days = 30): Promise<Array<{ date: string; members: number }>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const snapshots = await Stat.aggregate<{ _id: string; members: number }>([
      {
        $match: {
          type: 'guild_member_snapshot',
          value: guildId,
          createdAt: { $gte: since },
        },
      },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          members: { $last: '$additionalData.memberCount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return snapshots.map((s) => ({
      date: s._id,
      members: typeof s.members === 'number' ? s.members : 0,
    }));
  }

  async cleanup(retentionDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await Stat.deleteMany({ createdAt: { $lt: cutoff } });
    return result.deletedCount;
  }
}

const statsService = new StatsService();
export default statsService;
