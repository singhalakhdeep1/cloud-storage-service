/**
 * Storage quota accounting. Every change is a single atomic update, so concurrent uploads cannot push a user past
 * their limit and counters cannot drift or go negative.
 */
import { Types } from 'mongoose';
import File from '../models/File';
import User from '../models/User';
import AppError from '../utils/appError';
import { formatBytes } from '../utils/files';

type Id = Types.ObjectId | string;

/** Reserves `bytes` for the user, or throws 413 when that would exceed their limit. */
export async function reserve(userId: Id, bytes: number): Promise<void> {
    if (bytes <= 0) return;
    const updated = await User.findOneAndUpdate({ _id: userId, isActive: true, $expr: { $lte: [{ $add: ['$storageUsed', bytes] }, '$storageLimit'] } }, { $inc: { storageUsed: bytes } }, { new: true });
    if (!updated) {
        const user = await User.findById(userId).select('storageUsed storageLimit isActive');
        if (!user || !user.isActive) throw new AppError('User not found', 404);
        throw new AppError(`Storage limit exceeded. Used ${formatBytes(user.storageUsed)} of ${formatBytes(user.storageLimit)}`, 413, 'quota_exceeded');
    }
}

/** Gives bytes back (never below zero). */
export async function release(userId: Id, bytes: number): Promise<void> {
    if (bytes <= 0) return;
    await User.updateOne({ _id: userId }, [{ $set: { storageUsed: { $max: [0, { $subtract: ['$storageUsed', bytes] }] } } }]);
}

export async function addFile(userId: Id): Promise<void> {
    await User.updateOne({ _id: userId }, { $inc: { fileCount: 1 } });
}

export async function removeFile(userId: Id): Promise<void> {
    await User.updateOne({ _id: userId }, [{ $set: { fileCount: { $max: [0, { $subtract: ['$fileCount', 1] }] } } }]);
}

/** Recomputes a user's counters from their files (repair tool, run by the janitor on request). */
export async function recalculate(userId: Id): Promise<{ storageUsed: number; fileCount: number }> {
    const [row] = await File.aggregate<{ bytes: number; count: number }>([
        { $match: { uploadedBy: new Types.ObjectId(String(userId)) } },
        {
            $group: {
                _id: null,
                count: { $sum: 1 },
                bytes: { $sum: { $add: ['$size', { $sum: '$versions.size' }, { $sum: '$variants.size' }] } },
            },
        },
    ]);
    const result = { storageUsed: row?.bytes ?? 0, fileCount: row?.count ?? 0 };
    await User.updateOne({ _id: userId }, { $set: result });
    return result;
}
