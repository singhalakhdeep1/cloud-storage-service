import mongoose, { Schema } from 'mongoose';
import type { IShareLink } from '../types/models';

const shareLinkSchema = new Schema<IShareLink>(
    {
        file: { type: Schema.Types.ObjectId, ref: 'File', required: true },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        tokenHash: { type: String, required: true, unique: true },
        label: { type: String, maxlength: 100 },
        permission: { type: String, enum: ['view', 'download'], default: 'download' },
        passwordHash: { type: String, select: false },
        expiresAt: Date,
        maxDownloads: { type: Number, min: 1 },
        downloadCount: { type: Number, default: 0 },
        accessCount: { type: Number, default: 0 },
        lastAccessedAt: Date,
        revokedAt: Date,
    },
    { timestamps: true }
);

shareLinkSchema.index({ file: 1, createdAt: -1 });
shareLinkSchema.index({ createdBy: 1 });
// Links carry no objects, so expired ones can be dropped by MongoDB a day after they stop working.
shareLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600, sparse: true });

export default mongoose.model<IShareLink>('ShareLink', shareLinkSchema);
