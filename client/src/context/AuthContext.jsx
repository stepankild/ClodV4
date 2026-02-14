import { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../services/authService';
import { startProactiveRefresh, stopProactiveRefresh } from '../services/api';
import { startHeartbeat, stopHeartbeat } from '../services/heartbeatService';

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
      const hasRefreshToken = !!localStorage.getItem('refreshToken');
      if (savedUser && hasRefreshToken) {
        // Сначала показываем кешированного пользователя (мгновенный старт)
        try {
          const cached = JSON.parse(savedUser);
          setUser(cached);
        } catch { /* bad JSON — ignore */ }

        // Затем пробуем обновить данные с сервера (не блокируя UI)
        try {
          const userData = await authService.getMe();
          setUser(userData);
          localStorage.setItem('user', JSON.stringify(userData));
          startProactiveRefresh();
          startHeartbeat();
        } catch (error) {
          console.error('Auth init: getMe failed, using cached user:', error?.message);
          // НЕ выкидываем пользователя! Если есть refreshToken —
          // следующий API-вызов триггернёт refresh через interceptor.
          // Logout только если вообще нет токенов.
          if (!localStorage.getItem('refreshToken')) {
            setUser(null);
            localStorage.removeItem('accessToken');
            localStorage.removeItem('user');
            stopProactiveRefresh();
          } else {
            startProactiveRefresh();
            startHeartbeat();
          }
        }
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  const login = async (email, password) => {
    const data = await authService.login(email, password);
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    startProactiveRefresh();
    startHeartbeat();
    return data.user;
  };

  const logout = async () => {
    stopProactiveRefresh();
    stopHeartbeat();
    await authService.logout();
    setUser(null);
  };

  const hasPermission = (permission) => {
    if (!user || !user.permissions) return false;
    return user.permissions.includes('*') || user.permissions.includes(permission);
  };

  const hasAnyPermission = (permissions) => {
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
