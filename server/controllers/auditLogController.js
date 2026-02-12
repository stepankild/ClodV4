import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import { parseUserAgent } from '../utils/parseUserAgent.js';

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

// @desc    Get active sessions + login history
// @route   GET /api/audit-logs/sessions
export const getSessions = async (req, res) => {
  try {
    // 1. Активные пользователи (у кого есть refreshToken)
    const activeUsers = await User.find({
      refreshToken: { $ne: null },
      isActive: true,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
    }).select('_id name email').lean();

    const activeUserIds = activeUsers.map(u => u._id);
    const activeUserIdStrings = activeUserIds.map(id => id.toString());

    // 2. Последний логин каждого активного пользователя
    let activeSessions = [];
    if (activeUserIds.length > 0) {
      const lastLogins = await AuditLog.aggregate([
        { $match: { action: 'auth.login', user: { $in: activeUserIds } } },
        { $sort: { createdAt: -1 } },
        { $group: {
          _id: '$user',
          loginAt: { $first: '$createdAt' },
          ip: { $first: '$ip' },
          userAgent: { $first: '$userAgent' }
        }}
      ]);

      const loginMap = {};
      for (const l of lastLogins) {
        loginMap[l._id.toString()] = l;
      }

      const now = new Date();
      activeSessions = activeUsers.map(u => {
        const login = loginMap[u._id.toString()];
        const parsed = parseUserAgent(login?.userAgent);
        return {
          userId: u._id,
          name: u.name,
          email: u.email,
          loginAt: login?.loginAt || null,
          ip: login?.ip || '—',
          browser: parsed.browser,
          os: parsed.os,
          duration: login?.loginAt ? now - new Date(login.loginAt) : null
        };
      });
    }

    // 3. История: последние 50 логинов
    const logins = await AuditLog.find({ action: 'auth.login' })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('user', 'name email refreshToken')
      .lean();

    if (logins.length === 0) {
      return res.json({ activeSessions, loginHistory: [] });
    }

    // 4. Собрать ID пользователей и найти все логауты за этот период
    const uniqueUserIds = [...new Set(logins.map(l => l.user?._id?.toString()).filter(Boolean))];
    const earliestLogin = logins[logins.length - 1].createdAt;

    const logouts = await AuditLog.find({
      action: 'auth.logout',
      user: { $in: uniqueUserIds },
      createdAt: { $gte: earliestLogin }
    }).sort({ createdAt: 1 }).lean();

    // 5. Для каждого логина найти ближайший логаут
    const now = new Date();
    const loginHistory = logins.map(login => {
      const userId = login.user?._id?.toString();
      const loginTime = new Date(login.createdAt);

      // Найти первый логаут этого юзера после этого логина
      const logout = logouts.find(lo =>
        lo.user?.toString() === userId &&
        new Date(lo.createdAt) > loginTime
      );

      const isStillActive = !logout && activeUserIdStrings.includes(userId);
      const logoutTime = logout ? new Date(logout.createdAt) : null;
      const duration = logoutTime
        ? logoutTime - loginTime
        : (isStillActive ? now - loginTime : null);

      const parsed = parseUserAgent(login.userAgent);

      return {
        userId,
        name: login.user?.name || '—',
        loginAt: login.createdAt,
        logoutAt: logout?.createdAt || null,
        duration,
        ip: login.ip || '—',
        browser: parsed.browser,
        os: parsed.os,
        isActive: isStillActive
      };
    });

    res.json({ activeSessions, loginHistory });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
