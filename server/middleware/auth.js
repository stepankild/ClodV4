import { verifyAccessToken } from '../utils/jwt.js';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Не авторизован. Токен не предоставлен' });
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = verifyAccessToken(token);
      const user = await User.findById(decoded.userId).select('-password -refreshToken');

      if (!user) {
        return res.status(401).json({ message: 'Пользователь не найден' });
      }

      if (!user.isActive) {
        return res.status(401).json({ message: 'Аккаунт деактивирован' });
      }

      req.user = user;
      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Токен истёк', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ message: 'Недействительный токен' });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};
