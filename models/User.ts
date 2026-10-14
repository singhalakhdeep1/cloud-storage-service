import bcrypt from 'bcryptjs';
import mongoose, { Schema, type Model } from 'mongoose';
import { PROVIDER_NAMES, type IUser, type IUserMethods } from '../types/models';

const userSchema = new Schema<IUser, Model<IUser, object, IUserMethods>, IUserMethods>(
    {
        name: { type: String, required: [true, 'Please provide a name'], trim: true, maxlength: [50, 'Name cannot be more than 50 characters'] },
        email: {
            type: String,
            required: [true, 'Please provide an email'],
            unique: true,
            lowercase: true,
            trim: true,
            maxlength: 254,
            match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Please provide a valid email'],
        },
        password: { type: String, required: [true, 'Please provide a password'], minlength: [6, 'Password must be at least 6 characters'], select: false },
        role: { type: String, enum: ['user', 'admin'], default: 'user' },
        tokenVersion: { type: Number, default: 0 },
        storageUsed: { type: Number, default: 0, min: 0 },
        storageLimit: { type: Number, default: 5 * 1024 * 1024 * 1024 }, // 5 GB unless DEFAULT_STORAGE_LIMIT / an admin says otherwise
        fileCount: { type: Number, default: 0, min: 0 },
        isActive: { type: Boolean, default: true },
        lastLogin: Date,
        preferences: {
            defaultStorage: { type: String, enum: PROVIDER_NAMES },
            autoProcessImages: { type: Boolean, default: true },
            enableVirusScan: { type: Boolean, default: true },
            encryptFiles: { type: Boolean, default: false },
        },
    },
    { timestamps: true }
);

userSchema.index({ isActive: 1 });

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 12);
    next();
});

userSchema.methods.comparePassword = function (candidate: string): Promise<boolean> {
    return bcrypt.compare(candidate, this.password);
};

userSchema.methods.hasStorageSpace = function (fileSize: number): boolean {
    return this.storageUsed + fileSize <= this.storageLimit;
};

/** Convenience for scripts; request handlers use QuotaService (atomic) instead. */
userSchema.methods.updateStorage = function (fileSize: number, operation: 'add' | 'subtract' = 'add') {
    if (operation === 'add') {
        this.storageUsed += fileSize;
        this.fileCount += 1;
    } else {
        this.storageUsed = Math.max(0, this.storageUsed - fileSize);
        this.fileCount = Math.max(0, this.fileCount - 1);
    }
    return this.save();
};

const User = mongoose.model<IUser, Model<IUser, object, IUserMethods>>('User', userSchema);
export = User;
