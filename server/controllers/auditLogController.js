import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import { parseUserAgent } from '../utils/parseUserAgent.js';
import { geoipBatch } from '../utils/geoip.js';
import { getClientIp } from '../utils/getClientIp.js';

// Check if an IP is private/internal/CGN (not useful for GeoIP)
// Covers: 127.x, 10.x, 172.16-31.x, 192.168.x, 100.64-127.x (CGN RFC6598), IPv6 loopback/private
const PRIVATE_IP_RE = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1|::ffff:(10\.|172\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)|fc|fd|fe80)/;

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
    const TWO_MINUTES_AGO = new Date(Date.now() - 2 * 60 * 1000);

    // 1. Все пользователи с refreshToken (залогинены)
    const activeUsers = await User.find({
      refreshToken: { $ne: null },
      isActive: true,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
    }).select('_id name email lastActivity currentPage').lean();

    const activeUserIds = activeUsers.map(u => u._id);

    // Карта lastActivity для быстрого доступа
    const activityMap = {};
    for (const u of activeUsers) {
      activityMap[u._id.toString()] = u.lastActivity;
    }

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
        const isOnline = u.lastActivity && new Date(u.lastActivity) >= TWO_MINUTES_AGO;
        return {
          userId: u._id,
          name: u.name,
          email: u.email,
          loginAt: login?.loginAt || null,
          ip: login?.ip || '—',
          browser: parsed.browser,
          os: parsed.os,
          duration: login?.loginAt ? now - new Date(login.loginAt) : null,
          isOnline,
          currentPage: isOnline ? u.currentPage : null,
          lastActivity: u.lastActivity
        };
      });

      // Сортировка: онлайн первые, потом по lastActivity
      activeSessions.sort((a, b) => {
        if (a.isOnline && !b.isOnline) return -1;
        if (!a.isOnline && b.isOnline) return 1;
        return (new Date(b.lastActivity || 0)) - (new Date(a.lastActivity || 0));
      });
    }

    // 3. История: последние 50 логинов
    const logins = await AuditLog.find({ action: 'auth.login' })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('user', 'name email')
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

      const userLastActivity = activityMap[userId];
      const isStillActive = !logout && userLastActivity && new Date(userLastActivity) >= TWO_MINUTES_AGO;
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

    // Fix legacy private IPs: old audit entries recorded Railway's internal IP.
    // Replace with the real client IP from the current request (best effort).
    const realIp = getClientIp(req);
    const fixIp = (ip) => {
      if (!ip || ip === '—') return realIp || '—';
      const clean = ip.replace(/^::ffff:/, '');
      if (PRIVATE_IP_RE.test(clean)) return realIp || ip;
      return ip;
    };

    for (const s of activeSessions) { s.ip = fixIp(s.ip); }
    for (const h of loginHistory) { h.ip = fixIp(h.ip); }

    // GeoIP: resolve countries for all unique IPs (non-blocking, cached)
    const allIps = [
      ...activeSessions.map(s => s.ip),
      ...loginHistory.map(h => h.ip)
    ].filter(ip => ip && ip !== '—');

    const geoMap = await geoipBatch(allIps);

    // Attach country to sessions
    for (const s of activeSessions) {
      const geo = geoMap.get(s.ip);
      s.country = geo ? `${geo.countryCode}` : null;
    }
    for (const h of loginHistory) {
      const geo = geoMap.get(h.ip);
      h.country = geo ? `${geo.countryCode}` : null;
    }

    res.json({ activeSessions, loginHistory });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
