import { verifyAccessToken } from '../utils/jwt.js';
import User from '../models/User.js';
import { t } from '../utils/i18n.js';

export const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: t('auth.tokenMissing', req.lang) });
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = verifyAccessToken(token);
      const user = await User.findById(decoded.userId).select('-password -refreshToken');

      if (!user) {
        return res.status(401).json({ message: t('auth.userNotFound', req.lang) });
      }

      if (!user.isActive || user.deletedAt) {
        return res.status(401).json({ message: t('auth.accountDisabled', req.lang) });
      }

      // Проверяем tokenVersion — если пароль был изменён, старый access token невалиден
      const tokenV = decoded.v ?? 0;
      const userV = user.tokenVersion || 0;
      if (tokenV !== userV) {
        return res.status(401).json({ message: t('auth.sessionInvalid', req.lang), code: 'TOKEN_EXPIRED' });
      }

      req.user = user;
      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: t('auth.tokenExpired', req.lang), code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ message: t('auth.tokenInvalid', req.lang) });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ message: t('common.serverError', req.lang) });
  }
};
