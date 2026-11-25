import { Schema, model, Document, Model } from 'mongoose';
import type { INote } from '@/types';

export interface NoteDocument extends INote, Document {
  getNoteCount(): number;
}

export interface NoteModel extends Model<NoteDocument> {
  getUserNotes(guildId: string, userId: string): Promise<NoteDocument>;
  addNote(guildId: string, userId: string, modId: string, content: string): Promise<NoteDocument>;
  clearNotes(guildId: string, userId: string): Promise<NoteDocument | null>;
}

const noteSchema = new Schema<NoteDocument, NoteModel>({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  guildId: {
    type: String,
    required: true,
    index: true,
  },
  notes: [
    {
      modId: { type: String, required: true },
      content: { type: String, required: true },
      date: { type: Date, default: Date.now },
    },
  ],
});

noteSchema.index({ guildId: 1, userId: 1 });

noteSchema.statics.getUserNotes = async function (guildId: string, userId: string) {
  let record = await this.findOne({ guildId, userId });
  if (!record) {
    record = await this.create({ guildId, userId, notes: [] });
  }
  return record;
};

noteSchema.statics.addNote = async function (guildId: string, userId: string, modId: string, content: string) {
  let record = await this.findOne({ guildId, userId });

  if (!record) {
    record = await this.create({
      guildId,
      userId,
      notes: [{ modId, content }],
    });
  } else {
    record.notes.push({ modId, content, date: new Date() });
    await record.save();
  }

  return record;
};

noteSchema.statics.clearNotes = async function (guildId: string, userId: string) {
  return this.findOneAndUpdate({ guildId, userId }, { notes: [] }, { returnDocument: 'after', upsert: true });
};

noteSchema.methods.getNoteCount = function () {
  return this.notes.length;
};

export default model<NoteDocument, NoteModel>('Note', noteSchema);
