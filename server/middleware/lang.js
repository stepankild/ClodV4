/**
 * Middleware для определения языка запроса.
 * Устанавливает req.lang ('ru' | 'en') на основе:
 * 1. Query param ?lang=en
 * 2. Accept-Language header
 * 3. Fallback: 'ru'
 */
export const detectLanguage = (req, res, next) => {
  // 1. Явный query param
  if (req.query.lang === 'en' || req.query.lang === 'ru') {
    req.lang = req.query.lang;
    return next();
  }

  // 2. Accept-Language header
  const acceptLang = req.headers['accept-language'] || '';
  if (acceptLang.startsWith('en')) {
    req.lang = 'en';
  } else {
    req.lang = 'ru';
  }

  next();
};
