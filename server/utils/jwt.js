import jwt from 'jsonwebtoken';

// JWT секреты — ОБЯЗАТЕЛЬНЫ, сервер не стартует без них
if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
  console.error('FATAL: JWT_SECRET and JWT_REFRESH_SECRET must be set in environment variables!');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

export const generateAccessToken = (userId) => {
  return jwt.sign(
    { userId },
    JWT_SECRET,
    { expiresIn: '24h' }      // 24 часа — баланс между безопасностью и удобством
  );
};

export const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId },
    JWT_REFRESH_SECRET,
    { expiresIn: '30d' }      // 30 дней — разумный срок для приватного приложения
  );
};

export const verifyAccessToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, JWT_REFRESH_SECRET);
};
