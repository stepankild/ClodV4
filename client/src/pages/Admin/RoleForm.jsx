import { useState, useEffect } from 'react';

const MODULE_LABELS = {
  users: 'Пользователи',
  view: 'Видимость разделов',
  dashboard: 'Дашборд',
  harvest: 'Урожай',
  rooms: 'Комнаты / циклы',
  clones: 'Клоны',
  vegetation: 'Вегетация',
  system: 'Система'
};

const RoleForm = ({ role, permissions, onSubmit, onClose }) => {
  const isCreate = !role;
  const isSystem = role?.isSystem ?? false;
  const hasWildcard = role?.permissions?.some((p) => p.name === '*');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (role) {
      setName(role.name || '');
      setDescription(role.description || '');
      setSelectedIds((role.permissions || []).map((p) => p._id));
    } else {
      setName('');
      setDescription('');
      setSelectedIds([]);
    }
  }, [role]);

  const togglePermission = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleAllInModule = (moduleName) => {
    const inModule = (permissions || []).filter((p) => p.module === moduleName);
    const ids = inModule.map((p) => p._id);
    const allSelected = ids.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...ids])]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        permissions: selectedIds
      });
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

  const permsByModule = (permissions || []).reduce((acc, p) => {
    const m = p.module || 'other';
    if (!acc[m]) acc[m] = [];
    acc[m].push(p);
    return acc;
  }, {});

  const sortedModules = Object.keys(permsByModule).sort((a, b) => {
    const order = ['view', 'users', 'dashboard', 'harvest', 'rooms', 'clones', 'vegetation', 'system', 'other'];
    return order.indexOf(a) - order.indexOf(b);
  });

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-dark-700">
          <h2 className="text-lg font-semibold text-white">
            {isCreate ? 'Создать роль' : 'Права роли'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-4 bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="p-4 space-y-4 overflow-y-auto">
            <div>
              <label className="block text-xs font-medium text-dark-400 mb-1">Название роли</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                readOnly={isSystem && role?.name === 'SuperAdmin'}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm placeholder-dark-500 read-only:opacity-70"
                placeholder="Например: Оператор"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-dark-400 mb-1">Описание</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm placeholder-dark-500"
                placeholder="Краткое описание"
              />
            </div>

            {hasWildcard && (
              <div className="text-amber-400/90 text-sm bg-amber-900/20 border border-amber-800/50 rounded-lg px-3 py-2">
                У этой роли полный доступ (*). Изменение списка прав не меняет доступ.
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-dark-400 mb-2">Права (что видит и что может делать)</label>
              <div className="space-y-4 border border-dark-600 rounded-lg p-3 bg-dark-900/50">
                {sortedModules.map((moduleKey) => {
                  const perms = permsByModule[moduleKey] || [];
                  return (
                  <div key={moduleKey}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold text-dark-300 uppercase tracking-wider">
                        {MODULE_LABELS[moduleKey] || moduleKey}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleAllInModule(moduleKey)}
                        className="text-xs text-primary-400 hover:text-primary-300"
                      >
                        {perms.every((p) => selectedIds.includes(p._id)) ? 'Снять все' : 'Выбрать все'}
                      </button>
                    </div>
                    <div className="space-y-1.5 pl-1">
                      {perms.map((p) => (
                        <label
                          key={p._id}
                          className="flex items-center gap-2 py-1 cursor-pointer group"
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(p._id)}
                            onChange={() => togglePermission(p._id)}
                            className="w-4 h-4 text-primary-600 bg-dark-700 border-dark-500 rounded focus:ring-primary-500"
                          />
                          <span className="text-sm text-dark-200 group-hover:text-white">
                            {p.description || p.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 p-4 border-t border-dark-700 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg text-sm font-medium"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Сохранение...' : isCreate ? 'Создать роль' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RoleForm;
