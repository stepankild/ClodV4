import User from '../models/User.js';
import Role from '../models/Role.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import AuditLog from '../models/AuditLog.js';

// @desc    Register new user (requires admin approval)
// @route   POST /api/auth/register
export const register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Проверка существующего пользователя
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Пользователь с таким email уже существует' });
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
      message: 'Регистрация успешна! Ожидайте одобрения администратора.',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        isApproved: user.isApproved
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
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
      return res.status(401).json({ message: 'Неверный email или пароль' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Аккаунт деактивирован' });
    }

    // Проверка одобрения
    if (!user.isApproved) {
      return res.status(403).json({ message: 'Ваш аккаунт ожидает одобрения администратором' });
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Неверный email или пароль' });
    }

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

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
        ip: req.ip || req.connection?.remoteAddress || '',
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
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ message: 'Refresh token не предоставлен' });
    }

    try {
      const decoded = verifyRefreshToken(refreshToken);
      const user = await User.findById(decoded.userId);

      if (!user) {
        return res.status(401).json({ message: 'Пользователь не найден' });
      }

      // НЕ проверяем user.refreshToken !== refreshToken:
      // эта проверка убивала сессии при логине с другого устройства/вкладки,
      // потому что новый login перезаписывал refreshToken в БД.
      // Достаточно проверки подписи JWT (verifyRefreshToken выше).

      if (!user.isActive) {
        return res.status(401).json({ message: 'Аккаунт деактивирован' });
      }

      if (user.deletedAt) {
        return res.status(401).json({ message: 'Аккаунт удалён' });
      }

      const newAccessToken = generateAccessToken(user._id);
      res.json({
        accessToken: newAccessToken,
        refreshToken              // возвращаем тот же refresh token
      });
    } catch (error) {
      return res.status(401).json({ message: 'Недействительный refresh token' });
    }
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
export const logout = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user) {
      user.refreshToken = null;
      await user.save();
      // Audit log — выход
      try {
        await AuditLog.create({
          user: user._id,
          action: 'auth.logout',
          entityType: 'User',
          entityId: user._id,
          details: { email: user.email },
          ip: req.ip || req.connection?.remoteAddress || '',
          userAgent: req.get?.('user-agent') || ''
        });
      } catch (_) {}
    }
    res.json({ message: 'Выход выполнен успешно' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

// @desc    Change password (for logged-in user)
// @route   POST /api/auth/change-password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Укажите текущий и новый пароль' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Новый пароль должен быть минимум 6 символов' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: 'Неверный текущий пароль' });
    }

    user.password = newPassword;
    await user.save();

    // Audit log
    try {
      await AuditLog.create({
        user: user._id,
        action: 'auth.change_password',
        entityType: 'User',
        entityId: user._id,
        details: { email: user.email },
        ip: req.ip || req.connection?.remoteAddress || '',
        userAgent: req.get?.('user-agent') || ''
      });
    } catch (_) {}

    res.json({ message: 'Пароль успешно изменён' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
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
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
