import { Schema, model, Document } from 'mongoose';

export interface IVerificationSession {
  guildId: string;
  channelId: string;
  userId: string;
  panelChannelId: string;
  panelMessageId: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface VerificationSessionDocument extends IVerificationSession, Document {}

const schema = new Schema<VerificationSessionDocument>(
  {
    guildId: { type: String, required: true },
    channelId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    panelChannelId: { type: String, default: '' },
    panelMessageId: { type: String, default: '' },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, required: true, min: 1, max: 5 },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

export default model<VerificationSessionDocument>('VerificationSession', schema);
