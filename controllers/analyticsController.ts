import * as analytics from '../services/analytics.service';
import type { UserDoc } from '../types/models';
import AppError from '../utils/appError';
import asyncHandler from '../utils/asyncHandler';

// @desc    My usage: totals, types, uploads per day, most downloaded
// @route   GET /api/analytics/dashboard
export const dashboard = asyncHandler(async (req, res) => {
    res.status(200).json({ success: true, data: await analytics.dashboard(req.user as UserDoc) });
});

// @desc    Storage analytics. Mine by default; `?scope=all` is for administrators and covers every user.
// @route   GET /api/analytics/storage
export const storage = asyncHandler(async (req, res) => {
    const user = req.user as UserDoc;
    if (req.query.scope === 'all') {
        if (user.role !== 'admin') throw new AppError('Only administrators can see service-wide analytics', 403, 'forbidden');
        res.status(200).json({ success: true, data: await analytics.overall() });
        return;
    }
    const mine = (await analytics.dashboard(user)) as { overview: { totalSize: number }; typeDistribution: unknown; topFiles: unknown };
    res.status(200).json({ success: true, data: { totalStorage: mine.overview.totalSize, storageByType: mine.typeDistribution, popularFiles: mine.topFiles } });
});
