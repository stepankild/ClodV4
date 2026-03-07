import { validationResult } from 'express-validator';

/**
 * Middleware: проверяет результат express-validator.
 * Ставится ПОСЛЕ массива валидационных правил.
 * Если есть ошибки — возвращает 400 с массивом сообщений.
 */
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map(e => e.msg);
    return res.status(400).json({ message: messages.join('. '), errors: errors.array() });
  }
  next();
};
