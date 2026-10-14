import mongoose, { Schema, type Model } from 'mongoose';
import cfg from '../config/env';
import { PROVIDER_NAMES, type IUploadSession, type IUploadSessionMethods } from '../types/models';

const uploadSessionSchema = new Schema<IUploadSession, Model<IUploadSession, object, IUploadSessionMethods>, IUploadSessionMethods>(
    {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        filename: { type: String, required: true },
        originalName: { type: String, required: true },
        mimeType: { type: String, required: true },
        totalSize: { type: Number, required: true, min: 0 },
        chunkSize: { type: Number, required: true, default: 5 * 1024 * 1024 },
        totalChunks: { type: Number, required: true, min: 1 },
        uploadedChunks: [{ type: Number }],
        chunkKeys: [{ _id: false, chunkNumber: Number, key: String, size: Number }],
        status: { type: String, enum: ['pending', 'uploading', 'paused', 'processing', 'completed', 'failed', 'cancelled', 'expired'], default: 'pending' },
        fileId: { type: Schema.Types.ObjectId, ref: 'File' },
        versionOf: { type: Schema.Types.ObjectId, ref: 'File' },
        uploadId: { type: String, unique: true, required: true },
        storageType: { type: String, enum: PROVIDER_NAMES },
        reservedBytes: { type: Number, default: 0, min: 0 },
        quotaUser: { type: Schema.Types.ObjectId, ref: 'User' },
        // Not a TTL index: the janitor must delete the chunk objects and release the reserved quota first.
        expiresAt: { type: Date, default: () => new Date(Date.now() + cfg.UPLOAD_SESSION_TTL_HOURS * 3600_000) },
        finishedAt: Date,
        metadata: { width: Number, height: Number, duration: Number },
        error: String,
    },
    { timestamps: true }
);

uploadSessionSchema.index({ user: 1, createdAt: -1 });
uploadSessionSchema.index({ status: 1, expiresAt: 1 });
// Finished sessions hold no objects any more, so their records can simply age out.
uploadSessionSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

uploadSessionSchema.methods.isComplete = function () {
    return this.uploadedChunks.length === this.totalChunks;
};

uploadSessionSchema.methods.getMissingChunks = function () {
    const have = new Set<number>(this.uploadedChunks);
    return Array.from({ length: this.totalChunks }, (_, i) => i).filter((i) => !have.has(i));
};

uploadSessionSchema.methods.getProgress = function () {
    return Math.round((this.uploadedChunks.length / this.totalChunks) * 100);
};

/**
 * Records a chunk and returns the updated session, or null when the session no longer accepts chunks (it is being
 * assembled, finished or cancelled). Safe when chunks arrive in parallel: one atomic update, and re-sending a chunk
 * replaces its record.
 */
uploadSessionSchema.methods.addChunk = async function (chunkNumber: number, key: string, size: number) {
    return this.model('UploadSession')
        .findOneAndUpdate(
            { _id: this._id, status: { $in: ['pending', 'uploading', 'paused'] } },
            [
                {
                    $set: {
                        chunkKeys: { $concatArrays: [{ $filter: { input: '$chunkKeys', cond: { $ne: ['$$this.chunkNumber', chunkNumber] } } }, [{ chunkNumber, key, size }]] },
                        uploadedChunks: { $setUnion: ['$uploadedChunks', [chunkNumber]] },
                        status: 'uploading',
                    },
                },
            ],
            { new: true }
        )
        .exec();
};

const UploadSession = mongoose.model<IUploadSession, Model<IUploadSession, object, IUploadSessionMethods>>('UploadSession', uploadSessionSchema);
export = UploadSession;
