const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
    filename: {
        type: String,
        required: true
    },
    originalName: {
        type: String,
        required: true
    },
    mimetype: {
        type: String,
        required: true
    },
    size: {
        type: Number,
        required: true
    },
    key: {
        type: String,
        required: true
    },
    location: {
        type: String,
        required: true
    },
    bucket: String,
    storageType: {
        type: String,
        enum: ['s3', 'local', 'digitalocean', 'minio'],
        default: 's3'
    },
    category: {
        type: String,
        enum: ['image', 'video', 'document', 'audio', 'other'],
        default: 'other'
    },
    isPublic: {
        type: Boolean,
        default: false
    },
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    metadata: {
        width: Number,
        height: Number,
        duration: Number,
        compressed: Boolean,
        format: String
    },
    variants: [{
        type: {
            type: String,
            enum: ['thumbnail', 'resized', 'converted', 'original']
        },
        key: String,
        size: Number,
        dimensions: {
            width: Number,
            height: Number
        },
        format: String,
        location: String
    }],
    versions: [{
        versionNumber: Number,
        key: String,
        size: Number,
        uploadedAt: Date,
        uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        reason: String
    }],
    currentVersion: {
        type: Number,
        default: 1
    },
    etag: String,
    isEncrypted: {
        type: Boolean,
        default: false
    },
    encryptionInfo: {
        iv: String,
        authTag: String
    },
    virusScanned: {
        type: Boolean,
        default: false
    },
    virusStatus: {
        type: String,
        enum: ['clean', 'infected', 'pending', 'error']
    },
    downloadCount: {
        type: Number,
        default: 0
    },
    tags: [String],
    accessControl: {
        type: String,
        enum: ['private', 'public', 'shared'],
        default: 'private'
    },
    sharedWith: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        permission: {
            type: String,
            enum: ['read', 'write', 'admin']
        },
        sharedAt: Date
    }],
    expiresAt: Date
}, {
    timestamps: true
});

// Indexes
fileSchema.index({ uploadedBy: 1, createdAt: -1 });
fileSchema.index({ category: 1 });
fileSchema.index({ tags: 1 });
fileSchema.index({ 'versions.versionNumber': 1 });
fileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Methods
fileSchema.methods.incrementDownloads = function () {
    this.downloadCount += 1;
    return this.save();
};

fileSchema.methods.addVariant = function(variantData) {
    this.variants.push(variantData);
    return this.save();
};

fileSchema.methods.addVersion = function(versionData) {
    this.currentVersion += 1;
    this.versions.push({
        versionNumber: this.currentVersion,
        ...versionData,
        uploadedAt: new Date()
    });
    return this.save();
};

fileSchema.methods.getVariant = function(type) {
    return this.variants.find(v => v.type === type);
};

fileSchema.methods.getLatestVersion = function() {
    return this.versions[this.versions.length - 1];
};

// Statics
fileSchema.statics.getStorageStats = async function () {
    return await this.aggregate([
        {
            $group: {
                _id: '$category',
                totalSize: { $sum: '$size' },
                count: { $sum: 1 }
            }
        }
    ]);
};

fileSchema.statics.getUserStorageStats = async function(userId) {
    return await this.aggregate([
        { $match: { uploadedBy: mongoose.Types.ObjectId(userId) } },
        {
            $group: {
                _id: '$category',
                totalSize: { $sum: '$size' },
                count: { $sum: 1 }
            }
        }
    ]);
};

module.exports = mongoose.model('File', fileSchema);
