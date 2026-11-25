import { Schema, model, Document } from 'mongoose';

export interface IWelcomeMessageRecord {
  guildId: string;
  userId: string;
  channelId: string;
  messageId: string;

  // timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface WelcomeMessageRecordDocument extends IWelcomeMessageRecord, Document {}

const schema = new Schema<WelcomeMessageRecordDocument>(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
  },
  { timestamps: true },
);

schema.index({ guildId: 1, userId: 1 }, { unique: true });

export default model<WelcomeMessageRecordDocument>('WelcomeMessageRecord', schema);
