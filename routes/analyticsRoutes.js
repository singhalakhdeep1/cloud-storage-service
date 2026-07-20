const express = require('express');
const router = express.Router();
const File = require('../models/File');
const auth = require('../middleware/auth');

/**
 * @swagger
 * /api/analytics/dashboard:
 *   get:
 *     summary: Get upload analytics dashboard
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Analytics data retrieved
 */
router.get('/dashboard', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // File statistics
    const totalFiles = await File.countDocuments({ user: userId });
    const totalSize = await File.aggregate([
      { $match: { user: mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, total: { $sum: '$size' } } }
    ]);

    // Uploads by type
    const typeDistribution = await File.aggregate([
      { $match: { user: mongoose.Types.ObjectId(userId) } },
      { $group: { _id: '$mimeType', count: { $sum: 1 }, size: { $sum: '$size' } } },
      { $sort: { count: -1 } }
    ]);

    // Uploads over time (last 30 days)
    const last30Days = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));

      const uploads = await File.countDocuments({
        user: userId,
        createdAt: { $gte: startOfDay, $lte: endOfDay }
      });

      last30Days.push({
        date: startOfDay.toISOString().split('T')[0],
        uploads
      });
    }

    // Storage usage by user
    const storageByUser = await File.aggregate([
      { $group: { _id: '$user', totalFiles: { $sum: 1 }, totalSize: { $sum: '$size' } } },
      { $sort: { totalSize: -1 } },
      { $limit: 10 }
    ]);

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalFiles,
          totalSize: totalSize[0]?.total || 0,
          avgFileSize: totalFiles > 0 ? (totalSize[0]?.total / totalFiles).toFixed(2) : 0
        },
        typeDistribution,
        uploadsOverTime: last30Days,
        topUsers: storageByUser
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @swagger
 * /api/analytics/storage:
 *   get:
 *     summary: Get storage analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Storage analytics retrieved
 */
router.get('/storage', auth, async (req, res) => {
  try {
    // Total storage used
    const totalStorage = await File.aggregate([
      { $group: { _id: null, total: { $sum: '$size' } } }
    ]);

    // Storage by file type
    const storageByType = await File.aggregate([
      { $group: { _id: '$mimeType', count: { $sum: 1 }, size: { $sum: '$size' } } },
      { $sort: { size: -1 } }
    ]);

    // Most uploaded files
    const popularFiles = await File.find()
      .sort({ downloadCount: -1 })
      .limit(10)
      .select('filename mimeType size downloadCount createdAt');

    res.status(200).json({
      success: true,
      data: {
        totalStorage: totalStorage[0]?.total || 0,
        storageByType,
        popularFiles
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
