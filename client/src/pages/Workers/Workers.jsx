import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { userService } from '../../services/userService';
import UserForm from '../Admin/UserForm';
import RoleForm from '../Admin/RoleForm';

// ── Shared constants ──
const MODULE_LABELS = {
  view: 'Видимость разделов',
  rooms: 'Комнаты',
  tasks: 'Задачи',
  clones: 'Клоны',
  vegetation: 'Вегетация',
  harvest: 'Сбор урожая',
  trim: 'Трим',
  archive: 'Архив',
  cycles: 'Циклы',
  templates: 'Шаблоны',
  users: 'Пользователи',
  system: 'Система'
};
const MODULE_ORDER = ['view', 'rooms', 'tasks', 'clones', 'vegetation', 'harvest', 'trim', 'archive', 'cycles', 'templates', 'users', 'system'];

const formatDate = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// ── Grouped permissions viewer (read-only) ──
const RolePermissionsView = ({ permissions, allPermissions }) => {
  // Group role's permissions by module
  const rolePermIds = new Set((permissions || []).map(p => p._id));
  // Group ALL permissions by module to show total counts
  const allByModule = {};
  for (const p of (allPermissions || [])) {
    const m = p.module || 'other';
    if (!allByModule[m]) allByModule[m] = [];
    allByModule[m].push(p);
  }

  // Only show modules that have at least one permission in the role
  const activeModules = MODULE_ORDER.filter(m => {
    const permsInModule = allByModule[m] || [];
    return permsInModule.some(p => rolePermIds.has(p._id));
  });

  if (permissions?.some(p => p.name === '*')) {
    return (
      <div className="mt-3 px-3 py-2 bg-amber-900/20 border border-amber-800/40 rounded-lg text-amber-400 text-sm">
        Полный доступ ко всем функциям (*)
      </div>
    );
  }

  if (activeModules.length === 0) {
    return <div className="mt-3 text-dark-500 text-sm">Нет назначенных прав</div>;
  }

  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {activeModules.map(moduleKey => {
        const allInModule = allByModule[moduleKey] || [];
        const activeInModule = allInModule.filter(p => rolePermIds.has(p._id));
        const allActive = activeInModule.length === allInModule.length;
        return (
          <div key={moduleKey} className="bg-dark-900/50 rounded-lg px-3 py-2 border border-dark-700/50">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
                {MODULE_LABELS[moduleKey] || moduleKey}
              </span>
              <span className={`text-xs font-medium ${allActive ? 'text-green-400' : 'text-dark-500'}`}>
                {activeInModule.length}/{allInModule.length}
              </span>
            </div>
            <div className="space-y-0.5">
              {activeInModule.map(p => (
                <div key={p._id} className="flex items-center gap-1.5 text-xs text-dark-300">
                  <svg className="w-3 h-3 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="truncate" title={p.description}>{p.description || p.name}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Main component ──
const Workers = () => {
  const { hasPermission } = useAuth();
  const canEditUsers = hasPermission && hasPermission('users:update');

  // Core data
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // UI state
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [roleFormRole, setRoleFormRole] = useState(null);
  const [deleteRoleConfirm, setDeleteRoleConfirm] = useState(null);
  const [expandedRoleId, setExpandedRoleId] = useState(null);

  // Trash
  const [showTrash, setShowTrash] = useState(false);
  const [deletedUsers, setDeletedUsers] = useState([]);
  const [deletedRoles, setDeletedRoles] = useState([]);
  const [restoringId, setRestoringId] = useState(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [usersData, rolesData, permsData] = await Promise.all([
        userService.getUsers(),
        userService.getRoles(),
        userService.getPermissions().catch(() => [])
      ]);
      setUsers(usersData);
      setRoles(rolesData);
      setPermissions(Array.isArray(permsData) ? permsData : []);
    } catch (err) {
      setError('Ошибка загрузки данных');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTrash = useCallback(async () => {
    try {
      const [du, dr] = await Promise.all([
        userService.getDeletedUsers().catch(() => []),
        userService.getDeletedRoles().catch(() => [])
      ]);
      setDeletedUsers(Array.isArray(du) ? du : []);
      setDeletedRoles(Array.isArray(dr) ? dr : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (showTrash && canEditUsers) loadTrash();
  }, [showTrash, canEditUsers, loadTrash]);

  // ── Handlers ──
  const handleCreate = () => { setEditingUser(null); setShowForm(true); };
  const handleEdit = (user) => { setEditingUser(user); setShowForm(true); };

  const handleDelete = async (userId) => {
    try {
      await userService.deleteUser(userId);
      setUsers(users.filter(u => u._id !== userId));
      setDeleteConfirm(null);
      // Refresh trash if open
      if (showTrash) loadTrash();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка удаления');
    }
  };

  const handleFormSubmit = async (formData) => {
    try {
      if (editingUser) {
        const updated = await userService.updateUser(editingUser._id, formData);
        setUsers(users.map(u => u._id === updated._id ? updated : u));
      } else {
        const created = await userService.createUser(formData);
        setUsers([created, ...users]);
      }
      setShowForm(false);
      setEditingUser(null);
    } catch (err) {
      throw err;
    }
  };

  const handleRoleFormSubmit = async (formData) => {
    if (roleFormRole) {
      const updated = await userService.updateRole(roleFormRole._id, formData);
      setRoles(roles.map(r => r._id === updated._id ? updated : r));
    } else {
      const created = await userService.createRole(formData);
      setRoles([...roles, created]);
    }
    setRoleFormRole(undefined);
  };

  const handleDeleteRole = async () => {
    if (!deleteRoleConfirm) return;
    try {
      await userService.deleteRole(deleteRoleConfirm._id);
      setRoles(roles.filter(r => r._id !== deleteRoleConfirm._id));
      setDeleteRoleConfirm(null);
      if (showTrash) loadTrash();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка удаления роли');
    }
  };

  const handleApprove = async (userId) => {
    try {
      const updated = await userService.approveUser(userId);
      setUsers(users.map(u => u._id === updated._id ? updated : u));
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка одобрения');
    }
  };

  const handleRestore = async (type, id) => {
    setRestoringId(`${type}-${id}`);
    try {
      if (type === 'user') {
        const restored = await userService.restoreUser(id);
        setDeletedUsers(prev => prev.filter(u => u._id !== id));
        setUsers(prev => [restored, ...prev]);
      } else {
        await userService.restoreRole(id);
        setDeletedRoles(prev => prev.filter(r => r._id !== id));
        // Reload roles to get populated permissions
        const rolesData = await userService.getRoles();
        setRoles(rolesData);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка восстановления');
    } finally {
      setRestoringId(null);
    }
  };

  const toggleRole = (roleId) => {
    setExpandedRoleId(prev => prev === roleId ? null : roleId);
  };

  // Split users
  const pendingUsers = users.filter(u => !u.isApproved);
  const approvedUsers = users.filter(u => u.isApproved);
  const trashCount = deletedUsers.length + deletedRoles.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Работники</h1>
          <p className="text-dark-400 mt-1">
            Управление пользователями, ролями и правами доступа.
          </p>
        </div>
        {canEditUsers && (
          <button
            onClick={handleCreate}
            className="flex items-center space-x-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-500 transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>Добавить</span>
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex items-center justify-between">
          <span className="text-sm">{error}</span>
          <button onClick={() => setError('')} className="ml-3 text-red-400 hover:text-red-300 text-sm font-medium">Закрыть</button>
        </div>
      )}

      {/* ── Роли и права — аккордеон ── */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-dark-700 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold text-white">Роли и права</h2>
            <p className="text-dark-400 text-sm mt-0.5">
              Нажмите на роль, чтобы увидеть подробные разрешения по модулям.
            </p>
          </div>
          {canEditUsers && (
            <button
              type="button"
              onClick={() => setRoleFormRole(null)}
              className="flex items-center gap-2 px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 text-sm font-medium"
            >
              <span className="text-lg leading-none">+</span>
              Создать роль
            </button>
          )}
        </div>
        <div className="divide-y divide-dark-700">
          {roles.map(r => {
            const isExpanded = expandedRoleId === r._id;
            const permCount = (r.permissions || []).length;
            const hasWildcard = (r.permissions || []).some(p => p.name === '*');
            return (
              <div key={r._id}>
                <div
                  className={`px-4 py-3 flex items-start justify-between gap-3 cursor-pointer transition hover:bg-dark-700/30 ${isExpanded ? 'bg-dark-700/20' : ''}`}
                  onClick={() => toggleRole(r._id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Expand arrow */}
                      <svg
                        className={`w-4 h-4 text-dark-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="font-medium text-white">{r.name}</span>
                      {r.isSystem && (
                        <span className="text-xs px-1.5 py-0.5 bg-dark-600 text-dark-400 rounded">системная</span>
                      )}
                      <span className="text-xs text-dark-500">
                        {hasWildcard ? 'полный доступ' : `${permCount} ${permCount === 1 ? 'право' : permCount < 5 ? 'права' : 'прав'}`}
                      </span>
                    </div>
                    {r.description && (
                      <p className="text-dark-400 text-sm mt-0.5 ml-6">{r.description}</p>
                    )}
                  </div>
                  {canEditUsers && (
                    <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setRoleFormRole(r)}
                        className="px-2 py-1.5 text-primary-400 hover:bg-primary-900/30 rounded-lg text-sm font-medium"
                      >
                        Изменить
                      </button>
                      {!r.isSystem && (
                        <button
                          type="button"
                          onClick={() => setDeleteRoleConfirm(r)}
                          className="px-2 py-1.5 text-red-400 hover:bg-red-900/30 rounded-lg text-sm font-medium"
                        >
                          Удалить
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {isExpanded && (
                  <div className="px-4 pb-4 ml-6">
                    <RolePermissionsView permissions={r.permissions} allPermissions={permissions} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Ожидающие одобрения ── */}
      {pendingUsers.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl mb-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-yellow-700/50 flex items-center gap-2">
            <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-lg font-semibold text-yellow-400">Ожидают одобрения ({pendingUsers.length})</h2>
          </div>
          <div className="divide-y divide-yellow-700/30">
            {pendingUsers.map(user => (
              <div key={user._id} className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="font-medium text-white">{user.name}</div>
                  <div className="text-sm text-dark-400">{user.email}</div>
                  <div className="text-xs text-dark-500 mt-1">
                    Зарегистрирован: {new Date(user.createdAt).toLocaleDateString('ru-RU')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canEditUsers && (
                    <>
                      <button
                        onClick={() => handleApprove(user._id)}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition font-medium"
                      >
                        Одобрить
                      </button>
                      <button
                        onClick={() => handleEdit(user)}
                        className="px-3 py-2 text-primary-400 hover:bg-primary-900/30 rounded-lg transition"
                        title="Редактировать и назначить роль"
                      >
                        Настроить
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setDeleteConfirm(user)}
                    className="px-3 py-2 text-red-400 hover:bg-red-900/30 rounded-lg transition"
                    title="Отклонить заявку"
                  >
                    Отклонить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Таблица пользователей ── */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-dark-900">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Работник</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Логин (email)</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Роли</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Статус</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Последний вход</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {approvedUsers.map(user => (
                <tr key={user._id} className="hover:bg-dark-700/50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-white">{user.name}</div>
                  </td>
                  <td className="px-6 py-4 text-dark-300">{user.email}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.roles?.map(role => (
                        <span
                          key={role._id}
                          className="inline-flex px-2 py-1 text-xs font-medium bg-blue-900/50 text-blue-400 rounded cursor-help"
                          title={role.description || role.name}
                        >
                          {role.name}
                        </span>
                      ))}
                      {(!user.roles || user.roles.length === 0) && (
                        <span className="text-xs text-dark-500">Нет ролей</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
                        user.isActive ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
                      }`}
                    >
                      {user.isActive ? 'Активен' : 'Неактивен'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-dark-400">
                      {user.lastLogin ? formatDate(user.lastLogin) : '—'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleEdit(user)}
                        className="p-2 text-dark-400 hover:text-blue-400 hover:bg-dark-700 rounded-lg transition"
                        title="Изменить логин, пароль, роли"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(user)}
                        className="p-2 text-dark-400 hover:text-red-400 hover:bg-dark-700 rounded-lg transition"
                        title="Удалить (можно восстановить)"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {approvedUsers.length === 0 && (
          <div className="text-center py-12 text-dark-400">Нет одобренных работников</div>
        )}
      </div>

      {/* ── Корзина (inline) ── */}
      {canEditUsers && (
        <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden mb-6">
          <button
            type="button"
            onClick={() => setShowTrash(prev => !prev)}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-dark-700/30 transition"
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-dark-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span className="font-medium text-dark-300">Корзина</span>
              {showTrash && trashCount > 0 && (
                <span className="text-xs px-1.5 py-0.5 bg-dark-600 text-dark-400 rounded-full">{trashCount}</span>
              )}
            </div>
            <svg
              className={`w-4 h-4 text-dark-500 transition-transform ${showTrash ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showTrash && (
            <div className="border-t border-dark-700 p-4">
              {trashCount === 0 ? (
                <div className="text-center py-4 text-dark-500 text-sm">Корзина пуста</div>
              ) : (
                <div className="space-y-4">
                  {/* Deleted users */}
                  {deletedUsers.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-dark-400 uppercase mb-2">
                        Удалённые пользователи ({deletedUsers.length})
                      </h3>
                      <div className="space-y-1">
                        {deletedUsers.map(u => (
                          <div key={u._id} className="flex items-center justify-between bg-dark-900/50 rounded-lg px-3 py-2">
                            <div>
                              <span className="text-sm text-white">{u.name}</span>
                              <span className="text-dark-500 text-xs ml-2">{u.email}</span>
                              <span className="text-dark-600 text-xs ml-2">удалён {formatDate(u.deletedAt)}</span>
                            </div>
                            <button
                              onClick={() => handleRestore('user', u._id)}
                              disabled={!!restoringId}
                              className="px-3 py-1 bg-green-700/50 text-green-400 rounded text-xs hover:bg-green-700/70 disabled:opacity-50 font-medium"
                            >
                              Восстановить
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Deleted roles */}
                  {deletedRoles.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-dark-400 uppercase mb-2">
                        Удалённые роли ({deletedRoles.length})
                      </h3>
                      <div className="space-y-1">
                        {deletedRoles.map(r => (
                          <div key={r._id} className="flex items-center justify-between bg-dark-900/50 rounded-lg px-3 py-2">
                            <div>
                              <span className="text-sm text-white">{r.name}</span>
                              {r.description && <span className="text-dark-500 text-xs ml-2">{r.description}</span>}
                              <span className="text-dark-600 text-xs ml-2">удалена {formatDate(r.deletedAt)}</span>
                            </div>
                            <button
                              onClick={() => handleRestore('role', r._id)}
                              disabled={!!restoringId}
                              className="px-3 py-1 bg-green-700/50 text-green-400 rounded text-xs hover:bg-green-700/70 disabled:opacity-50 font-medium"
                            >
                              Восстановить
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}

      {showForm && (
        <UserForm
          user={editingUser}
          roles={roles}
          onSubmit={handleFormSubmit}
          onClose={() => { setShowForm(false); setEditingUser(null); }}
        />
      )}

      {roleFormRole !== undefined && (
        <RoleForm
          role={roleFormRole}
          permissions={permissions}
          onSubmit={handleRoleFormSubmit}
          onClose={() => setRoleFormRole(undefined)}
        />
      )}

      {deleteRoleConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-dark-800 rounded-xl p-6 max-w-md w-full mx-4 border border-dark-700">
            <h3 className="text-lg font-semibold text-white mb-2">Удалить роль?</h3>
            <p className="text-dark-400 mb-6">
              Роль &laquo;{deleteRoleConfirm.name}&raquo; будет перемещена в корзину. Сначала снимите её у всех пользователей.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setDeleteRoleConfirm(null)}
                className="px-4 py-2 text-dark-300 hover:bg-dark-700 rounded-lg transition"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleDeleteRole}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-dark-800 rounded-xl p-6 max-w-md w-full mx-4 border border-dark-700">
            <h3 className="text-lg font-semibold text-white mb-2">Удалить работника?</h3>
            <p className="text-dark-400 mb-6">
              &laquo;{deleteConfirm.name}&raquo; будет перемещён в корзину. Его можно будет восстановить.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-dark-300 hover:bg-dark-700 rounded-lg transition"
              >
                Отмена
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm._id)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition"
              >
                В корзину
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Workers;
