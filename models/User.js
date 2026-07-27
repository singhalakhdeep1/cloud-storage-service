const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please provide a name'],
        trim: true,
        maxlength: [50, 'Name cannot be more than 50 characters']
    },
    email: {
        type: String,
        required: [true, 'Please provide an email'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [
            /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
            'Please provide a valid email'
        ]
    },
    password: {
        type: String,
        required: [true, 'Please provide a password'],
        minlength: [6, 'Password must be at least 6 characters'],
        select: false
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    storageUsed: {
        type: Number,
        default: 0
    },
    storageLimit: {
        type: Number,
        default: 5 * 1024 * 1024 * 1024 // 5GB default
    },
    fileCount: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: {
        type: Date
    },
    preferences: {
        defaultStorage: {
            type: String,
            enum: ['s3', 'local'],
            default: 's3'
        },
        autoProcessImages: {
            type: Boolean,
            default: true
        },
        enableVirusScan: {
            type: Boolean,
            default: true
        }
    }
}, {
    timestamps: true
});

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ isActive: 1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Method to check storage limit
userSchema.methods.hasStorageSpace = function(fileSize) {
    return (this.storageUsed + fileSize) <= this.storageLimit;
};

// Method to update storage usage
userSchema.methods.updateStorage = function(fileSize, operation = 'add') {
    if (operation === 'add') {
        this.storageUsed += fileSize;
        this.fileCount += 1;
    } else if (operation === 'subtract') {
        this.storageUsed = Math.max(0, this.storageUsed - fileSize);
        this.fileCount = Math.max(0, this.fileCount - 1);
    }
    return this.save();
};

module.exports = mongoose.model('User', userSchema);
