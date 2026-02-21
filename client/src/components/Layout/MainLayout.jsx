import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { authService } from '../../services/authService';
import Sidebar from './Sidebar';

const ChangePasswordModal = ({ onClose }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 6) {
      setError('Новый пароль минимум 6 символов');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);
    try {
      await authService.changePassword(currentPassword, newPassword);
      setSuccess('Пароль успешно изменён!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка смены пароля');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-dark-700">
          <h2 className="text-lg font-semibold text-white">Сменить пароль</h2>
          <button type="button" onClick={onClose} className="p-2 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-400 px-3 py-2 rounded-lg text-sm">{error}</div>
          )}
          {success && (
            <div className="bg-green-900/30 border border-green-800 text-green-400 px-3 py-2 rounded-lg text-sm">{success}</div>
          )}

          <div>
            <label className="block text-xs font-medium text-dark-400 mb-1">Текущий пароль</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm placeholder-dark-500"
              placeholder="Введите текущий пароль"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-dark-400 mb-1">Новый пароль</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm placeholder-dark-500"
              placeholder="Минимум 6 символов"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-dark-400 mb-1">Подтвердите новый пароль</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm placeholder-dark-500"
              placeholder="Повторите новый пароль"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg text-sm font-medium">
              Отмена
            </button>
            <button type="submit" disabled={loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 text-sm font-medium disabled:opacity-50">
              {loading ? 'Сохранение...' : 'Сменить пароль'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const MainLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-dark-950 flex">
      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-20 bg-dark-900 border-b border-dark-800 flex items-center justify-between px-4 lg:px-6">
          {/* Mobile menu button */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg text-dark-400 hover:bg-dark-800 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Page title placeholder */}
          <div className="hidden lg:block" />

          {/* User menu */}
          <div className="flex items-center space-x-4">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium text-white">{user?.name}</div>
              <div className="text-xs text-dark-400">{user?.email}</div>
            </div>

            <div className="relative group">
              <button className="flex items-center space-x-2 p-2 rounded-lg hover:bg-dark-800">
                <div className="w-8 h-8 bg-primary-900/50 rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium text-primary-400">
                    {user?.name?.charAt(0)?.toUpperCase()}
                  </span>
                </div>
                <svg className="w-4 h-4 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown */}
              <div className="absolute right-0 mt-2 w-52 bg-dark-800 rounded-lg shadow-lg border border-dark-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                <div className="p-2 space-y-1">
                  <button
                    onClick={() => setShowChangePassword(true)}
                    className="w-full flex items-center space-x-2 px-4 py-2 text-sm text-dark-300 hover:bg-dark-700 hover:text-white rounded-lg"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                    <span>Сменить пароль</span>
                  </button>
                  <button
                    onClick={logout}
                    className="w-full flex items-center space-x-2 px-4 py-2 text-sm text-red-400 hover:bg-dark-700 rounded-lg"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span>Выйти</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Change password modal */}
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
};

export default MainLayout;
