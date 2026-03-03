import { t } from '../utils/i18n.js';

export const checkPermission = (...requiredPermissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: t('common.unauthorized', req.lang) });
      }

      const userPermissions = await req.user.getPermissions();

      // SuperAdmin has all permissions
      if (userPermissions.includes('*')) {
        return next();
      }

      const hasPermission = requiredPermissions.some(permission =>
        userPermissions.includes(permission)
      );

      if (!hasPermission) {
        return res.status(403).json({
          message: t('common.forbidden', req.lang)
        });
      }

      next();
    } catch (error) {
      console.error('RBAC middleware error:', error);
      res.status(500).json({ message: t('common.serverError', req.lang) });
    }
  };
};
