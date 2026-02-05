import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { auditLogService } from '../../services/auditLogService';
import { userService } from '../../services/userService';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

const ACTION_LABELS = {
  'user.create': 'Создан пользователь',
  'user.update': 'Изменён пользователь',
  'user.delete': 'Удалён пользователь',
  'role.create': 'Создана роль',
  'role.update': 'Изменена роль',
  'role.delete': 'Удалена роль',
  'clone_cut.upsert': 'Нарезка клонов (создание/обновление)',
  'clone_cut.update': 'Нарезка клонов (изменение)',
  'veg_batch.create': 'Создан бэтч вегетации',
  'veg_batch.update': 'Изменён бэтч вегетации',
  'veg_batch.delete': 'Удалён бэтч вегетации',
  'harvest.archive': 'Урожай архивирован (ручной ввод весов)',
  'harvest.complete': 'Сбор урожая завершён (автоархив)',
  'harvest.plant_add': 'Записан куст при сборе',
  'archive.update': 'Изменён архив цикла',
  'room.cycle_start': 'Запущен цикл в комнате',
  'room.update': 'Изменена комната',
  'plan.upsert': 'План цикла (создание/обновление)',
  'plan.update': 'План цикла (изменение)',
  'plan.delete': 'План цикла удалён'
};

const AuditLog = () => {
  const { hasPermission } = useAuth();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [filterUserId, setFilterUserId] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const limit = 30;

  const canRead = hasPermission && hasPermission('audit:read');

  useEffect(() => {
    if (canRead) {
      loadUsers();
    }
  }, [canRead]);

  useEffect(() => {
    if (canRead) {
      loadLogs();
    }
  }, [canRead, page, filterUserId, filterAction, filterFrom, filterTo]);

  const loadUsers = async () => {
    try {
      const list = await userService.getUsers();
      setUsers(Array.isArray(list) ? list : []);
    } catch (_) {
      setUsers([]);
    }
  };

  const loadLogs = async () => {
    try {
      setLoading(true);
      setError('');
      const params = { page, limit };
      if (filterUserId) params.userId = filterUserId;
      if (filterAction) params.action = filterAction;
      if (filterFrom) params.from = filterFrom;
      if (filterTo) params.to = filterTo;
      const data = await auditLogService.getLogs(params);
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Ошибка загрузки лога');
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  if (!canRead) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center text-dark-400">
          <p className="text-lg font-medium">Нет доступа</p>
          <p className="text-sm mt-1">Для просмотра лога действий нужно право «Просмотр лога действий» (audit:read).</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(total / limit);
  const actionOptions = [...new Set(Object.keys(ACTION_LABELS))].sort();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Лог действий</h1>
        <p className="text-dark-400 mt-1">
          Кто что сделал и когда. Помогает найти, кто внёс изменение при ошибке.
        </p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex items-center gap-3">
          <span>{error}</span>
          <button type="button" onClick={loadLogs} className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium">
            Повторить
          </button>
        </div>
      )}

      <div className="bg-dark-800 rounded-xl border border-dark-700 p-4 mb-6">
        <h2 className="text-sm font-semibold text-dark-300 mb-3">Фильтры</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-dark-500 mb-1">Пользователь</label>
            <select
              value={filterUserId}
              onChange={(e) => { setFilterUserId(e.target.value); setPage(1); }}
              className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm min-w-[180px]"
            >
              <option value="">Все</option>
              {users.map((u) => (
                <option key={u._id} value={u._id}>{u.name} ({u.email})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-dark-500 mb-1">Действие</label>
            <select
              value={filterAction}
              onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
              className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm min-w-[220px]"
            >
              <option value="">Все</option>
              {actionOptions.map((a) => (
                <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-dark-500 mb-1">С</label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
              className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-500 mb-1">По</label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
              className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-700 flex items-center justify-between flex-wrap gap-2">
          <span className="text-dark-400 text-sm">Всего записей: <span className="text-white font-medium">{total}</span></span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2 py-1 bg-dark-700 text-dark-300 rounded text-sm disabled:opacity-50 hover:bg-dark-600"
              >
                ←
              </button>
              <span className="text-dark-400 text-sm">Стр. {page} из {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-2 py-1 bg-dark-700 text-dark-300 rounded text-sm disabled:opacity-50 hover:bg-dark-600"
              >
                →
              </button>
            </div>
          )}
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-dark-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Когда</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Кто</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Действие</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Детали</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-dark-500">
                      {page === 1 && !filterUserId && !filterAction && !filterFrom && !filterTo
                        ? 'Пока нет записей в логе.'
                        : 'Нет записей по выбранным фильтрам.'}
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log._id} className="hover:bg-dark-700/30">
                      <td className="px-4 py-3 text-dark-300 whitespace-nowrap">{formatDate(log.createdAt)}</td>
                      <td className="px-4 py-3">
                        <span className="text-white font-medium">{log.user?.name || '—'}</span>
                        {log.user?.email && <span className="text-dark-500 text-xs block">{log.user.email}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-primary-400">{ACTION_LABELS[log.action] || log.action}</span>
                      </td>
                      <td className="px-4 py-3 text-dark-300 max-w-md">
                        {log.details && Object.keys(log.details).length > 0 ? (
                          <div className="text-xs font-sans bg-dark-900/50 rounded px-2 py-1 overflow-x-auto">
                            {Object.entries(log.details)
                              .filter(([, v]) => v !== undefined && v !== null && v !== '')
                              .map(([k, v]) => (
                                <div key={k} className="truncate" title={String(v)}>
                                  <span className="text-dark-500">{k}:</span> <span className="text-dark-300">{String(v)}</span>
                                </div>
                              ))}
                          </div>
                        ) : (
                          <span className="text-dark-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLog;
