const counts = new Map<string, Map<string, number>>();

function key(guildId: string): Map<string, number> {
  let g = counts.get(guildId);
  if (!g) {
    g = new Map();
    counts.set(guildId, g);
  }
  return g;
}

export function increment(guildId: string, userId: string): number {
  const g = key(guildId);
  const next = (g.get(userId) ?? 0) + 1;
  g.set(userId, next);
  return next;
}

export function get(guildId: string, userId: string): number {
  return counts.get(guildId)?.get(userId) ?? 0;
}

export function reset(guildId: string, userId: string): void {
  counts.get(guildId)?.delete(userId);
}
