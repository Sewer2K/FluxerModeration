import { Schema, model, Document } from 'mongoose';

export interface ISocialState extends Document {
  guildId: string;
  key: string;
  lastSeenId: string | null;

  // timestamps
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ISocialState>(
  {
    guildId: { type: String, required: true },
    key: { type: String, required: true },
    lastSeenId: { type: String, default: null },
  },
  { timestamps: true },
);

schema.index({ guildId: 1, key: 1 }, { unique: true });

const SocialState = model<ISocialState>('SocialState', schema);
export default SocialState;
