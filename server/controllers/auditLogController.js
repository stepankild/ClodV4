import AuditLog from '../models/AuditLog.js';

// @desc    Get audit logs (paginated, filter by user, action, date)
// @route   GET /api/audit-logs
export const getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, userId, action, from, to } = req.query;
    const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(100, Math.max(1, parseInt(limit, 10)));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

    const query = {};
    if (userId) query.user = userId;
    if (action) query.action = new RegExp(action, 'i');
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('user', 'name email')
        .lean(),
      AuditLog.countDocuments(query)
    ]);

    res.json({ logs, total, page: parseInt(page, 10), limit: limitNum });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
