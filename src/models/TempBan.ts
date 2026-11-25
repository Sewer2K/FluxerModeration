import { Schema, model, Document, Model } from 'mongoose';

export interface ITempBan extends Document {
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string;
  expiresAt: Date;

  // timestamps
  createdAt: Date;
  updatedAt: Date;
}

interface TempBanModel extends Model<ITempBan> {
  findPending(): Promise<ITempBan[]>;
}

const schema = new Schema<ITempBan>(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    moderatorId: { type: String, required: true },
    reason: { type: String, default: 'No reason provided' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

schema.index({ guildId: 1, userId: 1 });
schema.index({ expiresAt: 1 });

schema.statics.findPending = function (): Promise<ITempBan[]> {
  return this.find({ expiresAt: { $gt: new Date() } });
};

const TempBan = model<ITempBan, TempBanModel>('TempBan', schema);
export default TempBan;
