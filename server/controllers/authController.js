import User from '../models/User.js';
import Role from '../models/Role.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import AuditLog from '../models/AuditLog.js';
import { getClientIp } from '../utils/getClientIp.js';
import { t } from '../utils/i18n.js';

// @desc    Register new user (requires admin approval)
// @route   POST /api/auth/register
export const register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Проверка существующего пользователя
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: t('auth.emailExists', req.lang) });
    }

    // Создаём пользователя без ролей, ждёт одобрения
    const user = new User({
      email,
      password,
      name,
      roles: [],
      isActive: true,
      isApproved: false  // Требует одобрения админа
    });

    await user.save();

    res.status(201).json({
      message: t('auth.registerSuccess', req.lang),
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        isApproved: user.isApproved
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email, $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }).populate({
      path: 'roles',
      populate: { path: 'permissions' }
    });

    if (!user) {
      return res.status(401).json({ message: t('auth.invalidCredentials', req.lang) });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: t('auth.accountDisabled', req.lang) });
    }

    // Проверка одобрения
    if (!user.isApproved) {
      return res.status(403).json({ message: t('auth.pendingApproval', req.lang) });
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({ message: t('auth.invalidCredentials', req.lang) });
    }

    const tv = user.tokenVersion || 0;
    const accessToken = generateAccessToken(user._id, tv);
    const refreshToken = generateRefreshToken(user._id, tv);

    // Save refresh token to database
    user.refreshToken = refreshToken;
    user.lastLogin = new Date();
    await user.save();

    // Get permissions
    const permissions = await user.getPermissions();

    // Audit log — вход
    try {
      await AuditLog.create({
        user: user._id,
        action: 'auth.login',
        entityType: 'User',
        entityId: user._id,
        details: { email: user.email },
        ip: getClientIp(req),
        userAgent: req.get?.('user-agent') || ''
      });
    } catch (_) { /* не блокируем логин из-за ошибки лога */ }

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        roles: user.roles.map(r => ({ id: r._id, name: r.name })),
        permissions
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ message: t('auth.refreshTokenMissing', req.lang) });
    }

    try {
      const decoded = verifyRefreshToken(refreshToken);
      const user = await User.findById(decoded.userId);

      if (!user) {
        return res.status(401).json({ message: t('auth.userNotFound', req.lang) });
      }

      if (!user.isActive) {
        return res.status(401).json({ message: t('auth.accountDisabled', req.lang) });
      }

      if (user.deletedAt) {
        return res.status(401).json({ message: t('auth.accountDeleted', req.lang) });
      }

      // Проверяем tokenVersion — если пароль был изменён, старые токены невалидны
      const tokenV = decoded.v ?? 0;
      const userV = user.tokenVersion || 0;
      if (tokenV !== userV) {
        return res.status(401).json({ message: t('auth.sessionInvalid', req.lang) });
      }

      const newAccessToken = generateAccessToken(user._id, userV);
      res.json({
        accessToken: newAccessToken,
        refreshToken              // возвращаем тот же refresh token
      });
    } catch (error) {
      return res.status(401).json({ message: t('auth.tokenInvalid', req.lang) });
    }
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
export const logout = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user) {
      user.refreshToken = null;
      user.lastActivity = null;
      user.currentPage = null;
      await user.save();
      // Audit log — выход
      try {
        await AuditLog.create({
          user: user._id,
          action: 'auth.logout',
          entityType: 'User',
          entityId: user._id,
          details: { email: user.email },
          ip: getClientIp(req),
          userAgent: req.get?.('user-agent') || ''
        });
      } catch (_) {}
    }
    res.json({ message: t('auth.logoutSuccess', req.lang) });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Change password (for logged-in user)
// @route   POST /api/auth/change-password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: t('auth.passwordRequired', req.lang) });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: t('auth.passwordTooShort', req.lang) });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: t('auth.userNotFound', req.lang) });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: t('auth.wrongPassword', req.lang) });
    }

    user.password = newPassword;
    // Инкрементируем tokenVersion — все старые токены на всех устройствах станут невалидны
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.refreshToken = null; // очищаем старый refresh token
    await user.save();

    // Генерируем новые токены с новой версией для текущей сессии
    const newAccessToken = generateAccessToken(user._id, user.tokenVersion);
    const newRefreshToken = generateRefreshToken(user._id, user.tokenVersion);
    user.refreshToken = newRefreshToken;
    await user.save();

    // Audit log
    try {
      await AuditLog.create({
        user: user._id,
        action: 'auth.change_password',
        entityType: 'User',
        entityId: user._id,
        details: { email: user.email },
        ip: getClientIp(req),
        userAgent: req.get?.('user-agent') || ''
      });
    } catch (_) {}

    res.json({
      message: t('auth.passwordChanged', req.lang),
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Heartbeat — update user presence (lastActivity + currentPage)
// @route   POST /api/auth/heartbeat
export const heartbeat = async (req, res) => {
  try {
    const { page } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      lastActivity: new Date(),
      currentPage: typeof page === 'string' ? page.slice(0, 200) : null
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password -refreshToken')
      .populate({
        path: 'roles',
        populate: { path: 'permissions' }
      });

    const permissions = await user.getPermissions();

    res.json({
      id: user._id,
      email: user.email,
      name: user.name,
      roles: user.roles.map(r => ({ id: r._id, name: r.name })),
      permissions
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};
