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
        enum: ['s3', 'local'],
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
        ref: 'User'
    },
    metadata: {
        width: Number,
        height: Number,
        duration: Number,
        compressed: Boolean
    },
    downloads: {
        type: Number,
        default: 0
    },
    tags: [String]
}, {
    timestamps: true
});

// Indexes
fileSchema.index({ uploadedBy: 1, createdAt: -1 });
fileSchema.index({ category: 1 });
fileSchema.index({ tags: 1 });

// Methods
fileSchema.methods.incrementDownloads = function () {
    this.downloads += 1;
    return this.save();
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

module.exports = mongoose.model('File', fileSchema);
