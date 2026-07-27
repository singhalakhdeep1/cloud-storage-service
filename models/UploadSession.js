const mongoose = require('mongoose');

const uploadSessionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    filename: {
        type: String,
        required: true
    },
    originalName: {
        type: String,
        required: true
    },
    mimeType: {
        type: String,
        required: true
    },
    totalSize: {
        type: Number,
        required: true
    },
    chunkSize: {
        type: Number,
        required: true,
        default: 5 * 1024 * 1024 // 5MB default
    },
    totalChunks: {
        type: Number,
        required: true
    },
    uploadedChunks: [{
        type: Number
    }],
    chunkKeys: [{
        chunkNumber: Number,
        key: String,
        size: Number
    }],
    status: {
        type: String,
        enum: ['pending', 'uploading', 'completed', 'failed', 'cancelled'],
        default: 'pending'
    },
    fileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File'
    },
    uploadId: {
        type: String,
        unique: true
    },
    expiresAt: {
        type: Date,
        default: Date.now,
        expires: 86400 // 24 hours
    },
    metadata: {
        width: Number,
        height: Number,
        duration: Number
    },
    error: {
        type: String
    }
}, {
    timestamps: true
});

// Indexes
uploadSessionSchema.index({ user: 1, createdAt: -1 });
uploadSessionSchema.index({ uploadId: 1 });
uploadSessionSchema.index({ status: 1 });
uploadSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Method to check if all chunks are uploaded
uploadSessionSchema.methods.isComplete = function() {
    return this.uploadedChunks.length === this.totalChunks;
};

// Method to get missing chunks
uploadSessionSchema.methods.getMissingChunks = function() {
    const allChunks = Array.from({ length: this.totalChunks }, (_, i) => i);
    return allChunks.filter(chunk => !this.uploadedChunks.includes(chunk));
};

// Method to calculate upload progress
uploadSessionSchema.methods.getProgress = function() {
    return Math.round((this.uploadedChunks.length / this.totalChunks) * 100);
};

// Method to add uploaded chunk
uploadSessionSchema.methods.addChunk = function(chunkNumber, key, size) {
    if (!this.uploadedChunks.includes(chunkNumber)) {
        this.uploadedChunks.push(chunkNumber);
        this.chunkKeys.push({ chunkNumber, key, size });
        this.status = 'uploading';
        return this.save();
    }
    return Promise.resolve(this);
};

// Static method to clean expired sessions
uploadSessionSchema.statics.cleanExpired = async function() {
    const result = await this.deleteMany({
        status: { $in: ['pending', 'uploading', 'failed'] },
        expiresAt: { $lt: new Date() }
    });
    return result.deletedCount;
};

module.exports = mongoose.model('UploadSession', uploadSessionSchema);
