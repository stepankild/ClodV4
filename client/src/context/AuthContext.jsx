import { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../services/authService';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const savedUser = localStorage.getItem('user');
      if (savedUser && authService.isAuthenticated()) {
        try {
          const userData = await authService.getMe();
          const u = userData || {};
          const normalized = {
            ...u,
            permissions: Array.isArray(u.permissions) ? u.permissions : [],
            roles: Array.isArray(u.roles) ? u.roles : []
          };
          setUser(normalized);
          localStorage.setItem('user', JSON.stringify(normalized));
        } catch (error) {
          console.error('Auth init error:', error);
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
        }
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  const login = async (email, password) => {
    const data = await authService.login(email, password);
    const u = data.user || {};
    const normalizedUser = {
      ...u,
      permissions: Array.isArray(u.permissions) ? u.permissions : [],
      roles: Array.isArray(u.roles) ? u.roles : []
    };
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('user', JSON.stringify(normalizedUser));
    setUser(normalizedUser);
    return normalizedUser;
  };

  const logout = async () => {
    await authService.logout();
    setUser(null);
  };

  const hasPermission = (permission) => {
    if (!user) return false;
    const perms = user.permissions;
    if (!Array.isArray(perms)) return false;
    return perms.includes('*') || perms.includes(permission);
  };

  const hasAnyPermission = (permissions) => {
    if (!Array.isArray(permissions)) return false;
    return permissions.some(p => hasPermission(p));
  };

  const value = {
    user,
    loading,
    login,
    logout,
    hasPermission,
    hasAnyPermission,
    isAuthenticated: !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
