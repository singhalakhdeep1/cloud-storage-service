import mongoose, { Schema } from 'mongoose';
import type { IIntegration } from '../types/models';

const integrationSchema = new Schema<IIntegration>(
    {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        type: { type: String, enum: ['slack', 'dropbox', 'googleDrive'], required: true },
        config: { type: String, required: true, select: false },
        enabled: { type: Boolean, default: true },
        lastUsedAt: Date,
        lastError: String,
    },
    { timestamps: true }
);

integrationSchema.index({ user: 1, type: 1 }, { unique: true });

export default mongoose.model<IIntegration>('Integration', integrationSchema);
