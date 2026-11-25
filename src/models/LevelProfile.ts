import { Schema, model, type Model, type HydratedDocument } from 'mongoose';
import {
  levelFromXp,
  xpForLevel as xpForLevelFormula,
  totalXpForLevel as totalXpForLevelFormula,
} from '@/utils/leveling/formula';
import type { ILevelingFormula } from '@/types/Leveling';
import { DEFAULT_LEVELING } from '@/types/Leveling';

export interface ILevelProfile {
  guildId: string;
  userId: string;
  xp: number;
  level: number;
  messages: number;
  weeklyXp: number;
  monthlyXp: number;

  // timestamps
  createdAt: Date;
  updatedAt: Date;
}

export type LevelProfileDocument = HydratedDocument<ILevelProfile>;

interface LevelProfileModel extends Model<ILevelProfile> {
  addXp(guildId: string, userId: string, amount: number, formula?: ILevelingFormula): Promise<LevelProfileDocument>;
  getTop(guildId: string, limit?: number, sortField?: 'xp' | 'weeklyXp' | 'monthlyXp'): Promise<ILevelProfile[]>;
  getRank(guildId: string, userId: string): Promise<number | null>;
}

export function xpForLevel(level: number, formula: ILevelingFormula = DEFAULT_LEVELING.formula): number {
  return xpForLevelFormula(level, formula);
}

export function totalXpForLevel(level: number, formula: ILevelingFormula = DEFAULT_LEVELING.formula): number {
  return totalXpForLevelFormula(level, formula);
}

export function levelFromTotalXp(xp: number, formula: ILevelingFormula = DEFAULT_LEVELING.formula): number {
  return levelFromXp(xp, formula);
}

const levelProfileSchema = new Schema<ILevelProfile, LevelProfileModel>(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    xp: { type: Number, default: 0, min: 0 },
    level: { type: Number, default: 0, min: 0 },
    messages: { type: Number, default: 0, min: 0 },
    weeklyXp: { type: Number, default: 0, min: 0 },
    monthlyXp: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

levelProfileSchema.index({ guildId: 1, userId: 1 }, { unique: true });
levelProfileSchema.index({ guildId: 1, xp: -1 });
levelProfileSchema.index({ guildId: 1, weeklyXp: -1 });
levelProfileSchema.index({ guildId: 1, monthlyXp: -1 });

levelProfileSchema.statics.addXp = async function (
  guildId: string,
  userId: string,
  amount: number,
  formula: ILevelingFormula = DEFAULT_LEVELING.formula,
) {
  const doc = await this.findOneAndUpdate(
    { guildId, userId },
    { $inc: { xp: amount, messages: 1 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  const newLevel = levelFromXp(doc.xp, formula);
  if (newLevel !== doc.level) {
    doc.level = newLevel;
    await doc.save();
  }
  return doc;
};

levelProfileSchema.statics.getTop = function (
  guildId: string,
  limit = 10,
  sortField: 'xp' | 'weeklyXp' | 'monthlyXp' = 'xp',
) {
  const capped = Math.min(Math.max(limit, 1), 50);
  return this.find({ guildId })
    .sort({ [sortField]: -1 })
    .limit(capped)
    .lean();
};

levelProfileSchema.statics.getRank = async function (guildId: string, userId: string) {
  const me = await this.findOne({ guildId, userId }).lean();
  if (!me) return null;
  const higher = await this.countDocuments({ guildId, xp: { $gt: me.xp } });
  return higher + 1;
};

export default model<ILevelProfile, LevelProfileModel>('LevelProfile', levelProfileSchema);
