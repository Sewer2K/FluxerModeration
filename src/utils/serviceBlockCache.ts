// service termination soft-block cache (ToS section 7)
// in-memory sets for the hot messageCreate path in the bot process. mutated on
// write by the !terminate command, lazy-loaded from mongo on first read.
// the web process does not write blocks, so the api reads mongo directly.

import ServiceBlock, {
  type IServiceBlock,
  type ServiceBlockDocument,
  type ServiceBlockTarget,
} from '@/models/ServiceBlock';
import config from '@/config';

const blockedGuilds = new Set<string>();
const blockedUsers = new Set<string>();
let loaded = false;
let loadPromise: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const blocks = await ServiceBlock.find().lean();
        for (const block of blocks) {
          if (block.targetType === 'guild') blockedGuilds.add(block.targetId);
          else blockedUsers.add(block.targetId);
        }
        loaded = true;
      } catch (err) {
        console.error('[serviceBlock] failed to load blocks:', err);
        loadPromise = null;
      }
    })();
  }
  await loadPromise;
}

export async function isGuildBlocked(guildId: string | null | undefined): Promise<boolean> {
  if (!guildId) return false;
  await ensureLoaded();
  return blockedGuilds.has(guildId);
}

export async function isUserBlocked(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  await ensureLoaded();
  return blockedUsers.has(userId);
}

export async function isBlocked(target: { guildId?: string | null; userId?: string | null }): Promise<boolean> {
  await ensureLoaded();
  if (target.guildId && blockedGuilds.has(target.guildId)) return true;
  if (target.userId && blockedUsers.has(target.userId)) return true;
  return false;
}

export async function addBlock(data: Omit<IServiceBlock, 'addedAt'>): Promise<ServiceBlockDocument> {
  const doc = await ServiceBlock.upsertBlock(data);
  if (data.targetType === 'guild') blockedGuilds.add(data.targetId);
  else blockedUsers.add(data.targetId);
  return doc;
}

export async function removeBlock(targetType: ServiceBlockTarget, targetId: string): Promise<boolean> {
  const removed = await ServiceBlock.removeBlock(targetType, targetId);
  if (targetType === 'guild') blockedGuilds.delete(targetId);
  else blockedUsers.delete(targetId);
  return removed;
}

export async function getBlock(targetType: ServiceBlockTarget, targetId: string): Promise<ServiceBlockDocument | null> {
  return ServiceBlock.isBlocked(targetType, targetId);
}

export async function listBlocks(targetType?: ServiceBlockTarget): Promise<ServiceBlockDocument[]> {
  return ServiceBlock.listBlocks(targetType);
}

// test hook, resets the in-memory sets so a fresh load happens next read
export function _resetServiceBlockCache(): void {
  blockedGuilds.clear();
  blockedUsers.clear();
  loaded = false;
  loadPromise = null;
  lastNotified.clear();
}

// rate limit the refusal reply so a terminated user can't spam the bot into
// flooding the channel. one notice per user (per guild) per window.
const NOTICE_WINDOW_MS = 60 * 1000;
const lastNotified = new Map<string, number>();

export function shouldSendTerminationNotice(guildId: string | null | undefined, userId: string): boolean {
  const key = `${guildId ?? 'dm'}:${userId}`;
  const now = Date.now();
  const last = lastNotified.get(key);
  if (last && now - last < NOTICE_WINDOW_MS) return false;
  lastNotified.set(key, now);
  return true;
}

export function terminationNotice(kind: ServiceBlockTarget): string {
  const brand = config.branding.publicName;
  const tag = config.terminationAppealTag;
  const subject =
    kind === 'guild'
      ? `This server has been terminated from ${brand} under our Terms of Service.`
      : `Your access to ${brand} has been terminated under our Terms of Service.`;
  return tag
    ? `${subject}\nTo appeal, add **${tag}** as a friend on Fluxer and DM them.`
    : `${subject}\nContact the operator of this ${brand} deployment to appeal.`;
}
