import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import { parseUserAgent } from '../utils/parseUserAgent.js';
import { geoipBatch } from '../utils/geoip.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { t } from '../utils/i18n.js';

// Check if an IP is private/internal/CGN (not useful for GeoIP)
// Covers: 127.x, 10.x, 172.16-31.x, 192.168.x, 100.64-127.x (CGN RFC6598), IPv6 loopback/private
const PRIVATE_IP_RE = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1|::ffff:(10\.|172\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)|fc|fd|fe80)/;

// Лимит на «глубину» аудита в getSessions — последние 5000 логин/логаут-событий на всю систему.
// Для расчёта total time этого достаточно, а от неограниченных сканов мы защищены.
const SESSIONS_LOG_LIMIT = 5000;
// Максимум 3 часа для orphan-сессии без явного logout (раньше было 8ч — искажало стату из-за ночных вкладок).
const MAX_SESSION_MS = 3 * 60 * 60_000;

// Безопасный парсинг даты из query-параметра. Возвращает Date или null.
const parseQueryDate = (v, endOfDay = false) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  // Если прилетело YYYY-MM-DD (без времени) — интерпретируем границы суток в UTC.
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
    d.setUTCHours(23, 59, 59, 999);
  }
  return d;
};

// @desc    Get audit logs (paginated, filter by user, action, date, entity, search)
// @route   GET /api/audit-logs
export const getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, userId, action, from, to, entityType, entityId, search } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const query = {};
    if (userId && typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
      query.user = userId;
    }
    if (action && typeof action === 'string') {
      query.action = new RegExp(escapeRegex(action), 'i');
    }

    const fromDate = parseQueryDate(from, false);
    const toDate = parseQueryDate(to, true);
    if (from && !fromDate) return res.status(400).json({ message: t('audit.invalidFromDate', req.lang) });
    if (to && !toDate) return res.status(400).json({ message: t('audit.invalidToDate', req.lang) });
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = fromDate;
      if (toDate) query.createdAt.$lte = toDate;
    }

    if (entityType && typeof entityType === 'string') query.entityType = entityType;
    if (entityId && typeof entityId === 'string') {
      if (mongoose.Types.ObjectId.isValid(entityId)) {
        // entityId хранится как Mixed, поэтому матчим обе формы (string и ObjectId)
        query.$or = [{ entityId }, { entityId: new mongoose.Types.ObjectId(entityId) }];
      } else {
        query.entityId = entityId;
      }
    }

    // Серверный поиск по action и сериализованным details (регэкс).
    // Ограниченно, но намного полезнее, чем клиентский поиск только по текущей странице.
    if (search && typeof search === 'string' && search.trim().length > 0) {
      const re = new RegExp(escapeRegex(search.trim()), 'i');
      const searchOr = [{ action: re }, { 'details.name': re }, { 'details.strain': re }, { 'details.email': re }, { 'details.title': re }, { 'details.cycleName': re }, { 'details.roomName': re }];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchOr }];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
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

    res.json({ logs, total, page: pageNum, limit: limitNum });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get active sessions + login history
// @route   GET /api/audit-logs/sessions
export const getSessions = async (req, res) => {
  try {
    const TWO_MINUTES_AGO = new Date(Date.now() - 2 * 60 * 1000);

    // 1. Активные пользователи (refreshToken != null)
    const activeUsers = await User.find({
      refreshToken: { $ne: null },
      isActive: true,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
    }).select('_id name email lastActivity currentPage').lean();

    const activeUserIds = activeUsers.map(u => u._id);

    const activityMap = new Map();
    for (const u of activeUsers) {
      activityMap.set(u._id.toString(), u.lastActivity);
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

      const loginMap = new Map();
      for (const l of lastLogins) loginMap.set(l._id.toString(), l);

      // Кэшируем parseUserAgent — одинаковые UA встречаются часто
      const uaCache = new Map();
      const cachedParse = (ua) => {
        if (!ua) return parseUserAgent(ua);
        if (uaCache.has(ua)) return uaCache.get(ua);
        const parsed = parseUserAgent(ua);
        uaCache.set(ua, parsed);
        return parsed;
      };

      const now = new Date();
      activeSessions = activeUsers.map(u => {
        const login = loginMap.get(u._id.toString());
        const parsed = cachedParse(login?.userAgent);
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

    // 4. Логауты за период истории — для спаривания login↔logout в loginHistory
    const uniqueUserIds = [...new Set(logins.map(l => l.user?._id?.toString()).filter(Boolean))];
    const earliestLogin = logins[logins.length - 1].createdAt;

    const logouts = await AuditLog.find({
      action: 'auth.logout',
      user: { $in: uniqueUserIds },
      createdAt: { $gte: earliestLogin }
    }).sort({ createdAt: 1 }).lean();

    // UA-кэш общий для всего запроса
    const uaCache = new Map();
    const cachedParse = (ua) => {
      if (!ua) return parseUserAgent(ua);
      if (uaCache.has(ua)) return uaCache.get(ua);
      const parsed = parseUserAgent(ua);
      uaCache.set(ua, parsed);
      return parsed;
    };

    const now = new Date();
    const loginHistory = logins.map(login => {
      const userId = login.user?._id?.toString();
      const loginTime = new Date(login.createdAt);
      const logout = logouts.find(lo =>
        lo.user?.toString() === userId && new Date(lo.createdAt) > loginTime
      );
      const userLastActivity = activityMap.get(userId);
      const isStillActive = !logout && userLastActivity && new Date(userLastActivity) >= TWO_MINUTES_AGO;
      const logoutTime = logout ? new Date(logout.createdAt) : null;
      const duration = logoutTime
        ? logoutTime - loginTime
        : (isStillActive ? now - loginTime : null);
      const parsed = cachedParse(login.userAgent);

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

    // 5. Total time per user — по ограниченной выборке последних событий
    // (вместо чтения всей истории logins/logouts без лимита).
    const allUserIds = [...new Set([
      ...activeSessions.map(s => s.userId?.toString()),
      ...loginHistory.map(h => h.userId)
    ].filter(Boolean))];

    if (allUserIds.length > 0) {
      // Загружаем последние SESSIONS_LOG_LIMIT событий login/logout для этих юзеров одним запросом
      const authEvents = await AuditLog.find({
        action: { $in: ['auth.login', 'auth.logout'] },
        user: { $in: allUserIds }
      })
        .sort({ createdAt: -1 })
        .limit(SESSIONS_LOG_LIMIT)
        .select('user action createdAt')
        .lean();

      // Группируем по user один раз: O(N), не O(users × N)
      const byUser = new Map();
      for (const e of authEvents) {
        const uid = e.user?.toString();
        if (!uid) continue;
        if (!byUser.has(uid)) byUser.set(uid, { logins: [], logouts: [] });
        const bucket = byUser.get(uid);
        if (e.action === 'auth.login') bucket.logins.push(e);
        else bucket.logouts.push(e);
      }

      const totalTimeMap = new Map();
      for (const uid of allUserIds) {
        const bucket = byUser.get(uid);
        if (!bucket) { totalTimeMap.set(uid, 0); continue; }
        // Сортируем по возрастанию для алгоритма парирования
        const uLogins = [...bucket.logins].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const uLogouts = [...bucket.logouts].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        let total = 0;
        for (let i = 0; i < uLogins.length; i++) {
          const loginTime = new Date(uLogins[i].createdAt);
          const nextLoginTime = i < uLogins.length - 1
            ? new Date(uLogins[i + 1].createdAt)
            : null;

          const logoutIdx = uLogouts.findIndex(lo => {
            const loTime = new Date(lo.createdAt);
            return loTime > loginTime && (!nextLoginTime || loTime <= nextLoginTime);
          });

          if (logoutIdx !== -1) {
            total += new Date(uLogouts[logoutIdx].createdAt) - loginTime;
            uLogouts.splice(logoutIdx, 1);
          } else if (!nextLoginTime) {
            // Последний логин, логаута нет — считаем только если юзер онлайн сейчас
            const la = activityMap.get(uid);
            if (la && new Date(la) >= TWO_MINUTES_AGO) {
              total += Math.min(now - loginTime, MAX_SESSION_MS);
            }
          } else {
            // Нет логаута, но следующий логин есть — кэпим длительность
            const gap = nextLoginTime - loginTime;
            total += Math.min(gap, MAX_SESSION_MS);
          }
        }
        totalTimeMap.set(uid, total);
      }

      for (const s of activeSessions) {
        s.totalTime = totalTimeMap.get(s.userId?.toString()) || 0;
      }
    }

    // 6. Legacy private IPs (Railway internal). Не переписываем на IP текущего админа —
    // просто помечаем, чтобы в UI было видно.
    const fixIp = (ip) => {
      if (!ip || ip === '—') return '—';
      const clean = ip.replace(/^::ffff:/, '');
      if (PRIVATE_IP_RE.test(clean)) return 'internal';
      return ip;
    };

    for (const s of activeSessions) { s.ip = fixIp(s.ip); }
    for (const h of loginHistory) { h.ip = fixIp(h.ip); }

    // 7. GeoIP (с persistent-кэшем в utils/geoip.js, 24h TTL)
    const allIps = [
      ...activeSessions.map(s => s.ip),
      ...loginHistory.map(h => h.ip)
    ].filter(ip => ip && ip !== '—' && ip !== 'internal');

    const geoMap = await geoipBatch(allIps);

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
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};
