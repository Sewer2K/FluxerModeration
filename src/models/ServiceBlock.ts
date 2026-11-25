import { Schema, model, Document, Model } from 'mongoose';

export type ServiceBlockTarget = 'guild' | 'user';

export interface IServiceBlock {
  targetType: ServiceBlockTarget;
  targetId: string;
  reason: string;
  evidence: string | null;
  addedBy: string;
  addedAt: Date;
  // set on user blocks created as a side effect of terminating a guild, so we
  // know the block came from that guild's owner cascade and can undo it together
  linkedGuildId: string | null;
}

export interface ServiceBlockDocument extends IServiceBlock, Document {}

export interface ServiceBlockModel extends Model<ServiceBlockDocument> {
  isBlocked(targetType: ServiceBlockTarget, targetId: string): Promise<ServiceBlockDocument | null>;
  upsertBlock(data: Omit<IServiceBlock, 'addedAt'>): Promise<ServiceBlockDocument>;
  removeBlock(targetType: ServiceBlockTarget, targetId: string): Promise<boolean>;
  listBlocks(targetType?: ServiceBlockTarget): Promise<ServiceBlockDocument[]>;
}

const serviceBlockSchema = new Schema<ServiceBlockDocument, ServiceBlockModel>({
  targetType: {
    type: String,
    enum: ['guild', 'user'],
    required: true,
  },
  targetId: {
    type: String,
    required: true,
  },
  reason: {
    type: String,
    required: true,
  },
  evidence: {
    type: String,
    default: null,
  },
  addedBy: {
    type: String,
    required: true,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
  linkedGuildId: {
    type: String,
    default: null,
  },
});

serviceBlockSchema.index({ targetType: 1, targetId: 1 }, { unique: true });

serviceBlockSchema.statics.isBlocked = async function (targetType: ServiceBlockTarget, targetId: string) {
  return this.findOne({ targetType, targetId }).lean();
};

serviceBlockSchema.statics.upsertBlock = async function (data: Omit<IServiceBlock, 'addedAt'>) {
  return this.findOneAndUpdate(
    { targetType: data.targetType, targetId: data.targetId },
    { $set: { ...data, addedAt: new Date() } },
    { returnDocument: 'after', upsert: true },
  );
};

serviceBlockSchema.statics.removeBlock = async function (targetType: ServiceBlockTarget, targetId: string) {
  const result = await this.deleteOne({ targetType, targetId });
  return result.deletedCount > 0;
};

serviceBlockSchema.statics.listBlocks = async function (targetType?: ServiceBlockTarget) {
  const query = targetType ? { targetType } : {};
  return this.find(query).sort({ addedAt: -1 }).lean();
};

const ServiceBlock = model<ServiceBlockDocument, ServiceBlockModel>('ServiceBlock', serviceBlockSchema);
export default ServiceBlock;
