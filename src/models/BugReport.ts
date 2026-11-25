import { Schema, model, Document, Model } from 'mongoose';

export type BugReportStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type BugReportReplyDelivery = 'pending' | 'sent' | 'failed';

export interface BugReportReply {
  replyId: string;
  authorId: string;
  message: string;
  deliveryStatus: BugReportReplyDelivery;
  deliveryError: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

export interface IBugReport {
  reporterId: string;
  reporterUsername: string;
  reporterAvatar: string | null;
  guildId: string;
  guildName: string;
  description: string;
  links: string[];
  status: BugReportStatus;
  replies: BugReportReply[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BugReportDocument extends IBugReport, Document {}
export type BugReportModel = Model<BugReportDocument>;

const replySchema = new Schema<BugReportReply>(
  {
    replyId: { type: String, required: true },
    authorId: { type: String, required: true },
    message: { type: String, required: true, maxlength: 4000 },
    deliveryStatus: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
    },
    deliveryError: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    deliveredAt: { type: Date, default: null },
  },
  { _id: false },
);

const bugReportSchema = new Schema<BugReportDocument, BugReportModel>(
  {
    reporterId: { type: String, required: true, index: true },
    reporterUsername: { type: String, required: true, maxlength: 100 },
    reporterAvatar: { type: String, default: null },
    guildId: { type: String, required: true, index: true },
    guildName: { type: String, required: true, maxlength: 100 },
    description: { type: String, required: true, maxlength: 5000 },
    links: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },
    replies: { type: [replySchema], default: [] },
  },
  { timestamps: true },
);

bugReportSchema.index({ status: 1, createdAt: -1 });
bugReportSchema.index({ reporterId: 1, createdAt: -1 });

export default model<BugReportDocument, BugReportModel>('BugReport', bugReportSchema);
