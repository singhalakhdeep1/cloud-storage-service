import mongoose, { Schema, type Model } from 'mongoose';
import { PROVIDER_NAMES, type IFile, type IFileMethods } from '../types/models';

const encryptionInfo = { iv: String, authTag: String };

const fileSchema = new Schema<IFile, Model<IFile, object, IFileMethods>, IFileMethods>(
    {
        filename: { type: String, required: true },
        originalName: { type: String, required: true },
        mimetype: { type: String, required: true },
        size: { type: Number, required: true, min: 0 },
        key: { type: String, required: true },
        location: { type: String, required: true },
        bucket: String,
        storageType: { type: String, enum: PROVIDER_NAMES, default: 'local' },
        category: { type: String, enum: ['image', 'video', 'document', 'audio', 'other'], default: 'other' },
        isPublic: { type: Boolean, default: false },
        uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        description: { type: String, maxlength: 1000 },
        metadata: { width: Number, height: Number, duration: Number, compressed: Boolean, format: String },
        variants: [
            {
                type: { type: String, enum: ['thumbnail', 'resized', 'converted', 'original'] },
                key: String,
                size: Number,
                dimensions: { width: Number, height: Number },
                format: String,
                location: String,
                mimetype: String,
                isEncrypted: Boolean,
                encryptionInfo,
            },
        ],
        versions: [
            {
                versionNumber: Number,
                key: String,
                size: Number,
                originalName: String,
                mimetype: String,
                etag: String,
                checksum: String,
                uploadedAt: Date,
                uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
                reason: String,
                isEncrypted: Boolean,
                encryptionInfo,
            },
        ],
        currentVersion: { type: Number, default: 1 },
        etag: String,
        checksum: String,
        isEncrypted: { type: Boolean, default: false },
        encryptionInfo,
        virusScanned: { type: Boolean, default: false },
        virusStatus: { type: String, enum: ['clean', 'infected', 'pending', 'error'] },
        downloadCount: { type: Number, default: 0 },
        lastAccessedAt: Date,
        tags: { type: [String], default: [] },
        accessControl: { type: String, enum: ['private', 'public', 'shared'], default: 'private' },
        sharedWith: [
            {
                user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
                permission: { type: String, enum: ['read', 'write', 'admin'], default: 'read' },
                sharedAt: { type: Date, default: Date.now },
            },
        ],
        // Expired files are deleted (object and record) by the janitor; a TTL index would leave the object behind.
        expiresAt: Date,
        modifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        contentUpdatedAt: Date,
        deletedAt: { type: Date, default: null },
        deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
);

fileSchema.index({ uploadedBy: 1, deletedAt: 1, createdAt: -1 });
fileSchema.index({ 'sharedWith.user': 1, deletedAt: 1 });
fileSchema.index({ category: 1 });
fileSchema.index({ tags: 1 });
fileSchema.index({ expiresAt: 1 }, { sparse: true });
fileSchema.index({ deletedAt: 1 }, { sparse: true });

fileSchema.methods.incrementDownloads = function () {
    return this.model('File').updateOne({ _id: this._id }, { $inc: { downloadCount: 1 }, $set: { lastAccessedAt: new Date() } }).then(() => {
        this.downloadCount += 1;
    });
};

fileSchema.methods.addVariant = function (variant) {
    this.variants.push(variant);
    return this.save();
};

fileSchema.methods.getVariant = function (type) {
    return this.variants.find((v: { type: string }) => v.type === type);
};

fileSchema.methods.getLatestVersion = function () {
    return this.versions[this.versions.length - 1];
};

fileSchema.methods.storedBytes = function (): number {
    const sum = (list: { size?: number }[]) => list.reduce((n, x) => n + (x.size ?? 0), 0);
    return this.size + sum(this.versions) + sum(this.variants);
};

/** Storage totals per category across all files (administrators). */
fileSchema.statics.getStorageStats = function () {
    return this.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: '$category', totalSize: { $sum: '$size' }, count: { $sum: 1 } } }]);
};

fileSchema.statics.getUserStorageStats = function (userId: string) {
    return this.aggregate([{ $match: { uploadedBy: new mongoose.Types.ObjectId(userId), deletedAt: null } }, { $group: { _id: '$category', totalSize: { $sum: '$size' }, count: { $sum: 1 } } }]);
};

const File = mongoose.model<IFile, Model<IFile, object, IFileMethods>>('File', fileSchema);
export = File;
