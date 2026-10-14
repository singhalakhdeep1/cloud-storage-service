/** Usage analytics for one user, and (administrators) for the whole service. Every number comes from one aggregation. */
import type { Types } from 'mongoose';
import File from '../models/File';
import User from '../models/User';
import type { UserDoc } from '../types/models';

const DAY_MS = 86_400_000;

interface Row {
    _id: string | null;
    count: number;
    size: number;
}

/** Uploads per day for the last `days` days, with zero-filled gaps. */
async function uploadsPerDay(match: Record<string, unknown>, days: number): Promise<{ date: string; uploads: number; size: number }[]> {
    const since = new Date(Date.now() - (days - 1) * DAY_MS);
    since.setUTCHours(0, 0, 0, 0);
    const rows = await File.aggregate<{ _id: string; uploads: number; size: number }>([
        { $match: { ...match, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, uploads: { $sum: 1 }, size: { $sum: '$size' } } },
    ]);
    const byDay = new Map(rows.map((r) => [r._id, r]));
    return Array.from({ length: days }, (_, i) => {
        const d = new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10);
        return { date: d, uploads: byDay.get(d)?.uploads ?? 0, size: byDay.get(d)?.size ?? 0 };
    });
}

export async function dashboard(user: UserDoc): Promise<Record<string, unknown>> {
    const match = { uploadedBy: user._id as Types.ObjectId, deletedAt: null };
    const [byType, byCategory, top, perDay, trashed] = await Promise.all([
        File.aggregate<Row>([{ $match: match }, { $group: { _id: '$mimetype', count: { $sum: 1 }, size: { $sum: '$size' } } }, { $sort: { count: -1 } }, { $limit: 20 }]),
        File.aggregate<Row>([{ $match: match }, { $group: { _id: '$category', count: { $sum: 1 }, size: { $sum: '$size' } } }, { $sort: { size: -1 } }]),
        File.find(match).sort({ downloadCount: -1 }).limit(5).select('originalName mimetype size downloadCount createdAt'),
        uploadsPerDay(match, 30),
        File.countDocuments({ uploadedBy: user._id, deletedAt: { $ne: null } }),
    ]);
    const totalFiles = byCategory.reduce((n, r) => n + r.count, 0);
    const totalSize = byCategory.reduce((n, r) => n + r.size, 0);
    const fresh = await User.findById(user._id).select('storageUsed storageLimit');
    return {
        overview: {
            totalFiles,
            totalSize,
            avgFileSize: totalFiles ? Math.round(totalSize / totalFiles) : 0,
            trashedFiles: trashed,
            storageUsed: fresh?.storageUsed ?? 0,
            storageLimit: fresh?.storageLimit ?? user.storageLimit,
        },
        typeDistribution: byType.map((r) => ({ type: r._id, count: r.count, size: r.size })),
        categoryBreakdown: byCategory.map((r) => ({ category: r._id, count: r.count, size: r.size })),
        uploadsOverTime: perDay,
        topFiles: top,
    };
}

/** Service-wide numbers (administrators). */
export async function overall(): Promise<Record<string, unknown>> {
    const match = { deletedAt: null };
    const [byType, byProvider, byUser, totals, users] = await Promise.all([
        File.aggregate<Row>([{ $match: match }, { $group: { _id: '$mimetype', count: { $sum: 1 }, size: { $sum: '$size' } } }, { $sort: { size: -1 } }, { $limit: 20 }]),
        File.aggregate<Row>([{ $match: match }, { $group: { _id: '$storageType', count: { $sum: 1 }, size: { $sum: '$size' } } }, { $sort: { size: -1 } }]),
        File.aggregate<Row & { user?: { name: string; email: string } }>([
            { $match: match },
            { $group: { _id: '$uploadedBy', count: { $sum: 1 }, size: { $sum: '$size' } } },
            { $sort: { size: -1 } },
            { $limit: 10 },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user', pipeline: [{ $project: { name: 1, email: 1 } }] } },
            { $set: { user: { $first: '$user' } } },
        ]),
        File.aggregate<Row>([{ $match: match }, { $group: { _id: null, count: { $sum: 1 }, size: { $sum: '$size' } } }]),
        User.aggregate<{ _id: null; users: number; used: number; limit: number }>([{ $group: { _id: null, users: { $sum: 1 }, used: { $sum: '$storageUsed' }, limit: { $sum: '$storageLimit' } } }]),
    ]);
    return {
        totalFiles: totals[0]?.count ?? 0,
        totalSize: totals[0]?.size ?? 0,
        users: users[0]?.users ?? 0,
        storageUsed: users[0]?.used ?? 0,
        storageAllocated: users[0]?.limit ?? 0,
        storageByType: byType.map((r) => ({ type: r._id, count: r.count, size: r.size })),
        storageByProvider: byProvider.map((r) => ({ provider: r._id, count: r.count, size: r.size })),
        topUsers: byUser.map((r) => ({ userId: r._id, name: r.user?.name, email: r.user?.email, files: r.count, size: r.size })),
        uploadsOverTime: await uploadsPerDay(match, 30),
        popularFiles: await File.find(match).sort({ downloadCount: -1 }).limit(10).select('originalName mimetype size downloadCount createdAt'),
    };
}
