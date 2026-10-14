import mongoose, { Schema } from 'mongoose';
import type { IFileActivity } from '../types/models';

/** Who did what to a file (uploads, downloads, shares, restores). Kept for 90 days. */
const fileActivitySchema = new Schema<IFileActivity>(
    {
        file: { type: Schema.Types.ObjectId, ref: 'File', required: true },
        actor: { type: Schema.Types.ObjectId, ref: 'User' },
        action: { type: String, required: true },
        ip: String,
        userAgent: { type: String, maxlength: 300 },
        details: Schema.Types.Mixed,
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

fileActivitySchema.index({ file: 1, createdAt: -1 });
fileActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export default mongoose.model<IFileActivity>('FileActivity', fileActivitySchema);
