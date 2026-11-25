import { Schema, model, Document, Model } from 'mongoose';
import type {
  BanAppealHistoryAction,
  BanAppealSource,
  BanAppealState,
  IBanAppeal,
  IBanAppealAnswers,
  IBanAppealHistoryEntry,
} from '@/types';

export interface BanAppealDocument extends IBanAppeal, Document {}

export interface BanAppealModel extends Model<BanAppealDocument> {
  findLatest(guildId: string, userId: string): Promise<BanAppealDocument | null>;
}

const answersSchema = new Schema<IBanAppealAnswers>(
  {
    whatHappened: { type: String, default: '', maxlength: 1000 },
    whyLift: { type: String, default: '', maxlength: 1000 },
    whatDifferent: { type: String, default: '', maxlength: 1000 },
    evidence: { type: String, default: '', maxlength: 1000 },
    onlyFluxerAccount: { type: String, enum: ['yes', 'no', null], default: null },
  },
  { _id: false },
);

const historySchema = new Schema<IBanAppealHistoryEntry>(
  {
    at: { type: Date, default: Date.now },
    by: { type: String, required: true, maxlength: 32 },
    action: {
      type: String,
      enum: ['ban', 'submit', 'approve', 'deny', 'dismiss', 'blacklist', 'unban'] satisfies BanAppealHistoryAction[],
      required: true,
    },
    note: { type: String, default: '', maxlength: 1000 },
  },
  { _id: false },
);

const schema = new Schema<BanAppealDocument, BanAppealModel>(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    caseNumber: { type: Number, default: null, min: 1 },
    source: {
      type: String,
      enum: ['command', 'dashboard', 'automod', 'massban', 'unknown'] satisfies BanAppealSource[],
      default: 'unknown',
    },
    banReason: { type: String, default: '', maxlength: 1000 },
    moderatorId: { type: String, required: true, maxlength: 32 },
    permanent: { type: Boolean, default: true },
    eligible: { type: Boolean, default: false },
    state: {
      type: String,
      enum: ['none', 'pending', 'approved', 'denied', 'dismissed', 'blacklisted'] satisfies BanAppealState[],
      default: 'none',
    },
    submittedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: String, default: null, maxlength: 32 },
    staffReason: { type: String, default: '', maxlength: 1000 },
    nextEligibleAt: { type: Date, default: null },
    answers: { type: answersSchema, default: () => ({}) },
    history: {
      type: [historySchema],
      default: [],
      validate: { validator: (value: IBanAppealHistoryEntry[]) => value.length <= 20 },
    },
  },
  { timestamps: true },
);

schema.index({ guildId: 1, userId: 1 }, { unique: true });
schema.index({ guildId: 1, state: 1, submittedAt: -1 });

schema.statics.findLatest = function (guildId: string, userId: string) {
  return this.findOne({ guildId, userId });
};

export default model<BanAppealDocument, BanAppealModel>('BanAppeal', schema);
