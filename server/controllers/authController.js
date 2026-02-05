import User from '../models/User.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';

// @desc    Login user
// @route   POST /api/auth/login
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).populate({
      path: 'roles',
      populate: { path: 'permissions' }
    });

    if (!user) {
      return res.status(401).json({ message: 'Неверный email или пароль' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Аккаунт деактивирован' });
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

    // Get permissions (always array for frontend)
    let permissions = [];
    try {
      permissions = await user.getPermissions();
    } catch (e) {
      console.error('getPermissions error:', e);
    }
    if (!Array.isArray(permissions)) permissions = [];

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        roles: (user.roles || []).map(r => ({ id: r._id, name: r.name })),
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

      if (!user || user.refreshToken !== refreshToken) {
        return res.status(401).json({ message: 'Недействительный refresh token' });
      }

      if (!user.isActive) {
        return res.status(401).json({ message: 'Аккаунт деактивирован' });
      }

      const newAccessToken = generateAccessToken(user._id);
      const newRefreshToken = generateRefreshToken(user._id);

      user.refreshToken = newRefreshToken;
      await user.save();

      res.json({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
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
    }
    res.json({ message: 'Выход выполнен успешно' });
  } catch (error) {
    console.error('Logout error:', error);
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

    let permissions = [];
    try {
      permissions = await user.getPermissions();
    } catch (e) {
      console.error('getPermissions error:', e);
    }
    if (!Array.isArray(permissions)) permissions = [];

    res.json({
      id: user._id,
      email: user.email,
      name: user.name,
      roles: (user.roles || []).map(r => ({ id: r._id, name: r.name })),
      permissions
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
