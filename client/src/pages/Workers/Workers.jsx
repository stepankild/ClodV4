import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { userService } from '../../services/userService';
import UserForm from '../Admin/UserForm';
import RoleForm from '../Admin/RoleForm';

const Workers = () => {
  const { hasPermission } = useAuth();
  const canEditUsers = hasPermission && hasPermission('users:update');

  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [roleFormRole, setRoleFormRole] = useState(null);
  const [deleteRoleConfirm, setDeleteRoleConfirm] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
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
  };

  const handleCreate = () => {
    setEditingUser(null);
    setShowForm(true);
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setShowForm(true);
  };

  const handleDelete = async (userId) => {
    try {
      await userService.deleteUser(userId);
      setUsers(users.filter(u => u._id !== userId));
      setDeleteConfirm(null);
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
      setRoles(roles.map((r) => (r._id === updated._id ? updated : r)));
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
      setRoles(roles.filter((r) => r._id !== deleteRoleConfirm._id));
      setDeleteRoleConfirm(null);
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

  // Разделяем пользователей на ожидающих одобрения и одобренных
  const pendingUsers = users.filter(u => !u.isApproved);
  const approvedUsers = users.filter(u => u.isApproved);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Работники</h1>
          <p className="text-dark-400 mt-1">
            Логин (email), пароль и разрешения. Админ может менять веса при сборе урожая и названия циклов, работник — нет.
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center space-x-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-500 transition"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Добавить</span>
        </button>
      </div>

      {/* Роли и права — настраиваемо */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-dark-700 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-semibold text-white">Роли и права</h2>
            <p className="text-dark-400 text-sm mt-0.5">
              Настройте, кто что видит и что может редактировать. Назначьте роли пользователям выше.
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
          {roles.map((r) => (
            <div key={r._id} className="px-4 py-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-white">{r.name}</span>
                  {r.isSystem && (
                    <span className="text-xs px-1.5 py-0.5 bg-dark-600 text-dark-400 rounded">системная</span>
                  )}
                </div>
                {r.description && (
                  <p className="text-dark-400 text-sm mt-0.5">{r.description}</p>
                )}
                <div className="flex flex-wrap gap-1 mt-2">
                  {(r.permissions || []).map((p) => (
                    <span
                      key={p._id}
                      className="inline-flex px-2 py-0.5 text-xs bg-dark-700 text-dark-300 rounded"
                      title={p.description}
                    >
                      {p.name === '*' ? '*' : p.description || p.name}
                    </span>
                  ))}
                </div>
              </div>
              {canEditUsers && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setRoleFormRole(r)}
                    className="px-2 py-1.5 text-primary-400 hover:bg-primary-900/30 rounded-lg text-sm font-medium"
                  >
                    Изменить права
                  </button>
                  {!r.isSystem && (
                    <button
                      type="button"
                      onClick={() => setDeleteRoleConfirm(r)}
                      className="px-2 py-1.5 text-red-400 hover:bg-red-900/30 rounded-lg text-sm font-medium"
                    >
                      Удалить роль
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Ожидающие одобрения */}
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

      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-dark-900">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Работник</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Логин (email)</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Роли / разрешения</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Статус</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {approvedUsers.map((user) => (
                <tr key={user._id} className="hover:bg-dark-700/50">
                  <td className="px-6 py-4">
                    <div className="font-medium text-white">{user.name}</div>
                  </td>
                  <td className="px-6 py-4 text-dark-300">{user.email}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.roles?.map((role) => (
                        <span
                          key={role._id}
                          className="inline-flex px-2 py-1 text-xs font-medium bg-blue-900/50 text-blue-400 rounded"
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

      {showForm && (
        <UserForm
          user={editingUser}
          roles={roles}
          onSubmit={handleFormSubmit}
          onClose={() => {
            setShowForm(false);
            setEditingUser(null);
          }}
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
              Роль «{deleteRoleConfirm.name}» будет удалена. Сначала снимите её у всех пользователей.
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
                Удалить роль
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-dark-800 rounded-xl p-6 max-w-md w-full mx-4 border border-dark-700">
            <h3 className="text-lg font-semibold text-white mb-2">Удалить работника?</h3>
            <p className="text-dark-400 mb-6">
              Вы уверены, что хотите удалить "{deleteConfirm.name}"? Это действие нельзя отменить.
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
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Workers;
