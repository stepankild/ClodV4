import jwt from 'jsonwebtoken';

// Fallback секреты (ОБЯЗАТЕЛЬНО замени в Railway Variables на свои!)
const JWT_SECRET = process.env.JWT_SECRET || 'farm-portal-jwt-secret-change-me';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'farm-portal-refresh-secret-change-me';

if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET not set, using fallback. Set it in Railway Variables!');
}

export const generateAccessToken = (userId) => {
  return jwt.sign(
    { userId },
    JWT_SECRET,
    { expiresIn: '7d' }       // 7 дней — приватное приложение, минимизируем refresh-вызовы
  );
};

export const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId },
    JWT_REFRESH_SECRET,
    { expiresIn: '180d' }     // 180 дней — долгосрочная сессия, не ротируется при refresh
  );
};

export const verifyAccessToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, JWT_REFRESH_SECRET);
};
