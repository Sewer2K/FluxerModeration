import { Schema, model, Document, Model } from 'mongoose';

export interface IActivityDaily {
  guildId: string;
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
  channels: Record<string, number>;
  hours: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityDailyDocument extends IActivityDaily, Document {}
export type ActivityDailyModel = Model<ActivityDailyDocument>;

const activityDailySchema = new Schema<ActivityDailyDocument, ActivityDailyModel>(
  {
    guildId: { type: String, required: true },
    date: { type: String, required: true },
    messages: { type: Number, default: 0, min: 0 },
    commands: { type: Number, default: 0, min: 0 },
    activeMembers: { type: Number, default: 0, min: 0 },
    joins: { type: Number, default: 0, min: 0 },
    leaves: { type: Number, default: 0, min: 0 },
    voiceJoins: { type: Number, default: 0, min: 0 },
    voiceMinutes: { type: Number, default: 0, min: 0 },
    moderationActions: { type: Number, default: 0, min: 0 },
    automodActions: { type: Number, default: 0, min: 0 },
    tickets: { type: Number, default: 0, min: 0 },
    reports: { type: Number, default: 0, min: 0 },
    channels: { type: Map, of: Number, default: () => ({}) },
    hours: { type: Map, of: Number, default: () => ({}) },
  },
  { timestamps: true },
);

activityDailySchema.index({ guildId: 1, date: 1 }, { unique: true });
activityDailySchema.index({ date: 1 });

export default model<ActivityDailyDocument, ActivityDailyModel>('ActivityDaily', activityDailySchema);
