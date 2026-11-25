/** @deprecated Import from ./leveling instead */
export { trackMessageXp as trackMessage, getLevelingConfig } from './leveling';
export { applyLevelRoles, renderLevelUpMessage, resolveLevelUpChannelId } from './leveling/levelUp';
export { xpForLevel, totalXpForLevel, levelFromXp } from './leveling/formula';
export type { LevelUpResult } from './leveling';
