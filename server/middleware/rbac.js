export const checkPermission = (...requiredPermissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Не авторизован' });
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
          message: 'Недостаточно прав для выполнения этого действия'
        });
      }

      next();
    } catch (error) {
      console.error('RBAC middleware error:', error);
      res.status(500).json({ message: 'Ошибка сервера' });
    }
  };
};
