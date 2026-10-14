import mongoose, { Schema } from 'mongoose';
import { PROVIDER_NAMES, type IPendingUpload } from '../types/models';

/** An upload that goes straight from the client to the storage provider (presigned URL), waiting to be confirmed. */
const pendingUploadSchema = new Schema<IPendingUpload>(
    {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        key: { type: String, required: true, unique: true },
        storageType: { type: String, enum: PROVIDER_NAMES, required: true },
        filename: { type: String, required: true },
        mimetype: { type: String, required: true },
        size: { type: Number, required: true, min: 0 },
        status: { type: String, enum: ['pending', 'confirmed', 'rejected', 'expired'], default: 'pending' },
        versionOf: { type: Schema.Types.ObjectId, ref: 'File' },
        quotaUser: { type: Schema.Types.ObjectId, ref: 'User' },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

pendingUploadSchema.index({ user: 1, status: 1 });
pendingUploadSchema.index({ status: 1, expiresAt: 1 });

export default mongoose.model<IPendingUpload>('PendingUpload', pendingUploadSchema);
