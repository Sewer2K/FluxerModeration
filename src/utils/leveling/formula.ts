import type { ILevelingFormula } from '@/types/Leveling';
import { DEFAULT_LEVELING } from '@/types/Leveling';

function baseXpForLevel(level: number, curve: ILevelingFormula['curve']): number {
  if (curve === 'linear') return 100 + 50 * level;
  return 5 * level * level + 50 * level + 100;
}

export function xpForLevel(level: number, formula: ILevelingFormula = DEFAULT_LEVELING.formula): number {
  const mult = formula.multiplier || 1;
  return Math.max(1, Math.floor(baseXpForLevel(level, formula.curve) * mult));
}

export function totalXpForLevel(level: number, formula: ILevelingFormula = DEFAULT_LEVELING.formula): number {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpForLevel(i, formula);
  return total;
}

export function levelFromXp(xp: number, formula: ILevelingFormula = DEFAULT_LEVELING.formula): number {
  let level = 0;
  let remaining = xp;
  const max = formula.maxLevel ?? 1000;
  while (level < max && remaining >= xpForLevel(level, formula)) {
    remaining -= xpForLevel(level, formula);
    level++;
  }
  return level;
}

export function capXpForMaxLevel(xp: number, formula: ILevelingFormula = DEFAULT_LEVELING.formula): number {
  if (!formula.maxLevel) return xp;
  const cap = totalXpForLevel(formula.maxLevel, formula);
  return Math.min(xp, cap);
}
