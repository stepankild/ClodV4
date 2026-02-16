import { useState, useEffect, useCallback } from 'react';
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

const formatDateShort = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatDuration = (ms) => {
  if (!ms || ms < 0) return '—';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return '< 1м';
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}д`);
  if (hours > 0) parts.push(`${hours}ч`);
  if (mins > 0) parts.push(`${mins}м`);
  return parts.join(' ') || '< 1м';
};

const timeAgo = (date) => {
  if (!date) return '—';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
};

// Все действия с описаниями и цветами
const ACTION_LABELS = {
  // Авторизация
  'auth.login': { label: 'Вход в систему', icon: '🔑', color: 'text-green-400' },
  'auth.logout': { label: 'Выход из системы', icon: '🚪', color: 'text-dark-400' },
  'auth.change_password': { label: 'Смена пароля', icon: '🔐', color: 'text-yellow-400' },

  // Пользователи
  'user.create': { label: 'Создан пользователь', icon: '👤', color: 'text-blue-400' },
  'user.update': { label: 'Изменён пользователь', icon: '✏️', color: 'text-yellow-400' },
  'user.approve': { label: 'Одобрен пользователь', icon: '✅', color: 'text-green-400' },
  'user.delete': { label: 'Удалён пользователь', icon: '🗑️', color: 'text-red-400' },
  'user.restore': { label: 'Восстановлен пользователь', icon: '♻️', color: 'text-green-400' },

  // Роли
  'role.create': { label: 'Создана роль', icon: '🛡️', color: 'text-blue-400' },
  'role.update': { label: 'Изменена роль', icon: '🛡️', color: 'text-yellow-400' },
  'role.delete': { label: 'Удалена роль', icon: '🛡️', color: 'text-red-400' },
  'role.restore': { label: 'Восстановлена роль', icon: '🛡️', color: 'text-green-400' },

  // Комнаты
  'room.update': { label: 'Изменена комната', icon: '🏠', color: 'text-yellow-400' },
  'room.cycle_start': { label: 'Запущен цикл', icon: '🌱', color: 'text-green-400' },
  'room.note': { label: 'Добавлена заметка', icon: '📝', color: 'text-blue-400' },
  'room.harvest_reset': { label: 'Комната сброшена (сбор)', icon: '🏠', color: 'text-orange-400' },

  // Задачи
  'task.create': { label: 'Создана задача', icon: '📋', color: 'text-blue-400' },
  'task.quick_add': { label: 'Быстрая задача', icon: '⚡', color: 'text-blue-400' },
  'task.complete': { label: 'Задача выполнена', icon: '✅', color: 'text-green-400' },
  'task.uncomplete': { label: 'Задача снята', icon: '↩️', color: 'text-yellow-400' },
  'task.update': { label: 'Изменена задача', icon: '📋', color: 'text-yellow-400' },
  'task.delete': { label: 'Удалена задача', icon: '🗑️', color: 'text-red-400' },
  'task.restore': { label: 'Восстановлена задача', icon: '♻️', color: 'text-green-400' },

  // Клоны
  'clone_cut.create_order': { label: 'Заказ клонов', icon: '🌿', color: 'text-blue-400' },
  'clone_cut.create': { label: 'Создан бэтч клонов', icon: '✂️', color: 'text-green-400' },
  'clone_cut.upsert': { label: 'Нарезка клонов', icon: '✂️', color: 'text-green-400' },
  'clone_cut.update': { label: 'Изменены клоны', icon: '✂️', color: 'text-yellow-400' },
  'clone_cut.delete': { label: 'Удалены клоны', icon: '🗑️', color: 'text-red-400' },
  'clone_cut.restore': { label: 'Восстановлены клоны', icon: '♻️', color: 'text-green-400' },
  'clone_cut.dispose': { label: 'Списаны остатки клонов', icon: '🗑️', color: 'text-orange-400' },

  // Вегетация
  'veg_batch.create': { label: 'Создан бэтч вегетации', icon: '🌱', color: 'text-green-400' },
  'veg_batch.update': { label: 'Изменён бэтч', icon: '🌱', color: 'text-yellow-400' },
  'veg_batch.dispose_remaining': { label: 'Списаны остатки', icon: '🌱', color: 'text-orange-400' },
  'veg_batch.delete': { label: 'Удалён бэтч', icon: '🗑️', color: 'text-red-400' },
  'veg_batch.restore': { label: 'Восстановлен бэтч', icon: '♻️', color: 'text-green-400' },

  // Сбор урожая
  'harvest.session_start': { label: 'Начат сбор урожая', icon: '⚖️', color: 'text-blue-400' },
  'harvest.plant_add': { label: 'Записан куст', icon: '🌿', color: 'text-green-400' },
  'harvest.complete': { label: 'Сбор завершён', icon: '🎉', color: 'text-green-400' },
  'harvest.archive': { label: 'Урожай архивирован', icon: '📦', color: 'text-blue-400' },

  // Трим
  'trim.log_add': { label: 'Записан трим', icon: '✂️', color: 'text-green-400' },
  'trim.log_delete': { label: 'Удалён трим', icon: '🗑️', color: 'text-red-400' },
  'trim.log_restore': { label: 'Восстановлен трим', icon: '♻️', color: 'text-green-400' },
  'trim.archive_update': { label: 'Обновлён трим-архив', icon: '✂️', color: 'text-yellow-400' },
  'trim.complete': { label: 'Трим завершён', icon: '✅', color: 'text-green-400' },

  // Архив
  'archive.update': { label: 'Изменён архив цикла', icon: '📦', color: 'text-yellow-400' },
  'archive.delete': { label: 'Удалён архив', icon: '🗑️', color: 'text-red-400' },
  'archive.restore': { label: 'Восстановлен архив', icon: '♻️', color: 'text-green-400' },

  // Планы
  'plan.upsert': { label: 'План цикла создан', icon: '📅', color: 'text-blue-400' },
  'plan.update': { label: 'План цикла изменён', icon: '📅', color: 'text-yellow-400' },
  'plan.delete': { label: 'План цикла удалён', icon: '🗑️', color: 'text-red-400' },
  'plan.restore': { label: 'План восстановлен', icon: '♻️', color: 'text-green-400' },

  // Шаблоны
  'roomTemplate.create': { label: 'Создан шаблон', icon: '📐', color: 'text-blue-400' },
  'roomTemplate.delete': { label: 'Удалён шаблон', icon: '🗑️', color: 'text-red-400' },
};

// Названия деталей на русском
const DETAIL_LABELS = {
  email: 'Email',
  name: 'Имя',
  roomName: 'Комната',
  roomId: 'ID комнаты',
  cycleName: 'Цикл',
  strain: 'Сорт',
  plantsCount: 'Кустов',
  floweringDays: 'Дней цвет.',
  title: 'Название',
  type: 'Тип',
  note: 'Заметка',
  quantity: 'Кол-во',
  cutDate: 'Дата нарезки',
  isDone: 'Готово',
  isOrder: 'Заказ',
  flowerRoom: 'Комната',
  disposedCount: 'Списано',
  plantNumber: 'Куст №',
  wetWeight: 'Сырой вес',
  dryWeight: 'Сухой вес',
  popcornWeight: 'Попкорн',
  trimWeight: 'Вес трима',
  weight: 'Вес',
  plantsRecorded: 'Записано',
  archiveId: 'ID архива',
  rowCount: 'Рядов',
  harvestData: 'Данные урожая',
  isApproved: 'Одобрен'
};

// Группы действий для фильтра
const ACTION_GROUPS = [
  { label: 'Авторизация', options: ['auth.login', 'auth.logout', 'auth.change_password'] },
  { label: 'Пользователи', options: ['user.create', 'user.update', 'user.approve', 'user.delete', 'user.restore'] },
  { label: 'Роли', options: ['role.create', 'role.update', 'role.delete', 'role.restore'] },
  { label: 'Комнаты', options: ['room.update', 'room.cycle_start', 'room.note', 'room.harvest_reset'] },
  { label: 'Задачи', options: ['task.create', 'task.quick_add', 'task.complete', 'task.uncomplete', 'task.update', 'task.delete', 'task.restore'] },
  { label: 'Клоны', options: ['clone_cut.create', 'clone_cut.create_order', 'clone_cut.upsert', 'clone_cut.update', 'clone_cut.delete', 'clone_cut.restore', 'clone_cut.dispose'] },
  { label: 'Вегетация', options: ['veg_batch.create', 'veg_batch.update', 'veg_batch.dispose_remaining', 'veg_batch.delete', 'veg_batch.restore'] },
  { label: 'Сбор урожая', options: ['harvest.session_start', 'harvest.plant_add', 'harvest.complete', 'harvest.archive'] },
  { label: 'Трим', options: ['trim.log_add', 'trim.log_delete', 'trim.log_restore', 'trim.archive_update', 'trim.complete'] },
  { label: 'Архив', options: ['archive.update', 'archive.delete', 'archive.restore'] },
  { label: 'Планы', options: ['plan.upsert', 'plan.update', 'plan.delete', 'plan.restore'] },
  { label: 'Шаблоны', options: ['roomTemplate.create', 'roomTemplate.delete'] },
];

const AuditLog = () => {
  const { hasPermission } = useAuth();

  // Tabs
  const [activeTab, setActiveTab] = useState('sessions');

  // Sessions state
  const [sessions, setSessions] = useState({ activeSessions: [], loginHistory: [] });
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState('');

  // Log state
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
  const [search, setSearch] = useState('');
  const limit = 30;

  const canRead = hasPermission && hasPermission('audit:read');

  const loadUsers = async () => {
    try {
      const list = await userService.getUsers();
      setUsers(Array.isArray(list) ? list : []);
    } catch (_) {
      setUsers([]);
    }
  };

  const loadSessions = useCallback(async (silent = false) => {
    try {
      if (!silent) setSessionsLoading(true);
      setSessionsError('');
      const data = await auditLogService.getSessions();
      setSessions({
        activeSessions: Array.isArray(data.activeSessions) ? data.activeSessions : [],
        loginHistory: Array.isArray(data.loginHistory) ? data.loginHistory : []
      });
    } catch (err) {
      if (!silent) setSessionsError(err.response?.data?.message || err.message || 'Ошибка загрузки сессий');
    } finally {
      if (!silent) setSessionsLoading(false);
    }
  }, []);

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

  useEffect(() => {
    if (canRead) loadUsers();
  }, [canRead]);

  useEffect(() => {
    if (canRead && activeTab === 'sessions') loadSessions();
  }, [canRead, activeTab, loadSessions]);

  // Авто-рефреш сессий каждые 30 секунд
  useEffect(() => {
    if (!canRead || activeTab !== 'sessions') return;
    const interval = setInterval(() => loadSessions(true), 30_000);
    return () => clearInterval(interval);
  }, [canRead, activeTab, loadSessions]);

  useEffect(() => {
    if (canRead && activeTab === 'log') loadLogs();
  }, [canRead, activeTab, page, filterUserId, filterAction, filterFrom, filterTo]);

  if (!canRead) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center text-dark-400">
          <p className="text-lg font-medium">Нет доступа</p>
          <p className="text-sm mt-1">Нужно право «audit:read».</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(total / limit);

  // Фильтрация по тексту (локально по загруженным логам)
  const filteredLogs = search.trim()
    ? logs.filter(log => {
        const s = search.toLowerCase();
        const actionInfo = ACTION_LABELS[log.action];
        const actionLabel = actionInfo?.label || log.action;
        const userName = log.user?.name || '';
        const details = log.details ? Object.values(log.details).join(' ') : '';
        return (
          actionLabel.toLowerCase().includes(s) ||
          userName.toLowerCase().includes(s) ||
          details.toLowerCase().includes(s) ||
          log.action.toLowerCase().includes(s)
        );
      })
    : logs;

  // Рендер деталей
  const renderDetails = (log) => {
    if (!log.details || Object.keys(log.details).length === 0) return null;
    const entries = Object.entries(log.details).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (entries.length === 0) return null;

    return (
      <div className="text-xs space-y-0.5">
        {entries.map(([key, value]) => {
          const label = DETAIL_LABELS[key] || key;
          let displayValue = value;
          if (typeof value === 'boolean') displayValue = value ? 'Да' : 'Нет';
          else if (key.endsWith('Weight') || key === 'weight') displayValue = `${value}г`;
          else displayValue = String(value);
          return (
            <div key={key} className="flex gap-1.5">
              <span className="text-dark-500 shrink-0">{label}:</span>
              <span className="text-dark-300 truncate" title={displayValue}>{displayValue}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const hasFilters = filterUserId || filterAction || filterFrom || filterTo || search;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Лог действий</h1>
        <p className="text-dark-400 mt-1">Все действия пользователей в системе</p>
      </div>

      {/* Табы */}
      <div className="flex gap-1 mb-6">
        <button
          type="button"
          onClick={() => setActiveTab('sessions')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'sessions'
              ? 'bg-primary-600 text-white'
              : 'bg-dark-800 text-dark-400 border border-dark-700 hover:text-white hover:bg-dark-700'
          }`}
        >
          Сессии
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('log')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'log'
              ? 'bg-primary-600 text-white'
              : 'bg-dark-800 text-dark-400 border border-dark-700 hover:text-white hover:bg-dark-700'
          }`}
        >
          Лог действий
        </button>
      </div>

      {/* ===== ВКЛАДКА: СЕССИИ ===== */}
      {activeTab === 'sessions' && (
        <>
          {sessionsError && (
            <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex items-center gap-3">
              <span>{sessionsError}</span>
              <button type="button" onClick={loadSessions} className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium">Повторить</button>
            </div>
          )}

          {sessionsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500" />
            </div>
          ) : (
            <>
              {/* Активные сессии */}
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                  Активные сессии ({sessions.activeSessions.length})
                  <span className="text-xs text-dark-500 font-normal ml-1">
                    {sessions.activeSessions.filter(s => s.isOnline).length} онлайн
                  </span>
                  <button
                    type="button"
                    onClick={() => loadSessions()}
                    className="ml-auto p-1.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg transition"
                    title="Обновить"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </h2>

                {sessions.activeSessions.length === 0 ? (
                  <div className="bg-dark-800 rounded-xl border border-dark-700 p-8 text-center text-dark-500">
                    Нет активных сессий
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {sessions.activeSessions.map((s) => (
                      <div key={s.userId} className={`bg-dark-800 rounded-xl border p-4 ${s.isOnline ? 'border-green-800/50' : 'border-dark-700'}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="relative flex h-2.5 w-2.5">
                            {s.isOnline ? (
                              <>
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                              </>
                            ) : (
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500"></span>
                            )}
                          </span>
                          <span className="text-white font-medium">{s.name}</span>
                          <span className={`text-xs ml-auto ${s.isOnline ? 'text-green-400' : 'text-yellow-500'}`}>
                            {s.isOnline ? 'Онлайн' : 'Неактивен'}
                          </span>
                        </div>
                        {s.isOnline && s.currentPage && (
                          <div className="mb-2 px-2 py-1 bg-primary-900/30 border border-primary-800/30 rounded text-xs text-primary-400">
                            {s.currentPage}
                          </div>
                        )}
                        <div className="space-y-1 text-xs">
                          {!s.isOnline && s.lastActivity && (
                            <div className="flex justify-between">
                              <span className="text-dark-500">Был(а)</span>
                              <span className="text-yellow-500/80">{timeAgo(s.lastActivity)}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-dark-500">Вход</span>
                            <span className="text-dark-300">{formatDateShort(s.loginAt)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-dark-500">IP</span>
                            <span className="text-dark-300 font-mono">
                              {s.ip}
                              {s.country && <span className="ml-1.5 text-dark-500">{s.country}</span>}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-dark-500">Браузер</span>
                            <span className="text-dark-300">{s.browser} · {s.os}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-dark-500">Сессия</span>
                            <span className={`font-medium ${s.isOnline ? 'text-green-400' : 'text-dark-300'}`}>{formatDuration(s.duration)}</span>
                          </div>
                          {s.totalTime > 0 && (
                            <div className="flex justify-between">
                              <span className="text-dark-500">Всего в системе</span>
                              <span className="text-primary-400 font-medium">{formatDuration(s.totalTime)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* История входов */}
              <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-dark-700">
                  <span className="text-white font-medium text-sm">История входов</span>
                  <span className="text-dark-500 text-sm ml-2">({sessions.loginHistory.length})</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-dark-900">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Пользователь</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Вход</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Выход</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Длительность</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">IP</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Браузер</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-700">
                      {sessions.loginHistory.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-12 text-center text-dark-500">Нет записей</td>
                        </tr>
                      ) : (
                        sessions.loginHistory.map((h, i) => (
                          <tr key={i} className="hover:bg-dark-700/30">
                            <td className="px-4 py-2.5">
                              <span className="text-white font-medium">{h.name}</span>
                            </td>
                            <td className="px-4 py-2.5 text-dark-300 text-xs whitespace-nowrap">{formatDateShort(h.loginAt)}</td>
                            <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                              {h.isActive ? (
                                <span className="inline-flex items-center gap-1 text-green-400 font-medium">
                                  <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                  </span>
                                  Онлайн
                                </span>
                              ) : (
                                <span className="text-dark-400">{h.logoutAt ? formatDateShort(h.logoutAt) : '—'}</span>
                              )}
                            </td>
                            <td className={`px-4 py-2.5 text-xs font-medium ${h.isActive ? 'text-green-400' : 'text-dark-300'}`}>
                              {formatDuration(h.duration)}
                            </td>
                            <td className="px-4 py-2.5 text-dark-400 text-xs font-mono">
                              {h.ip}
                              {h.country && <span className="ml-1 text-dark-500 font-sans">{h.country}</span>}
                            </td>
                            <td className="px-4 py-2.5 text-dark-400 text-xs">{h.browser} · {h.os}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ===== ВКЛАДКА: ЛОГ ДЕЙСТВИЙ ===== */}
      {activeTab === 'log' && (
        <>
          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex items-center gap-3">
              <span>{error}</span>
              <button type="button" onClick={loadLogs} className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium">Повторить</button>
            </div>
          )}

          {/* Фильтры */}
          <div className="bg-dark-800 rounded-xl border border-dark-700 p-4 mb-6">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-dark-500 mb-1">Поиск</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Имя, действие, детали..."
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm placeholder-dark-500"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-500 mb-1">Пользователь</label>
                <select
                  value={filterUserId}
                  onChange={(e) => { setFilterUserId(e.target.value); setPage(1); }}
                  className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm min-w-[150px]"
                >
                  <option value="">Все</option>
                  {users.map((u) => (
                    <option key={u._id} value={u._id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-dark-500 mb-1">Действие</label>
                <select
                  value={filterAction}
                  onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
                  className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm min-w-[190px]"
                >
                  <option value="">Все</option>
                  {ACTION_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((a) => (
                        <option key={a} value={a}>{ACTION_LABELS[a]?.label || a}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-dark-500 mb-1">С</label>
                <input type="date" value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
                  className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
              </div>
              <div>
                <label className="block text-xs text-dark-500 mb-1">По</label>
                <input type="date" value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
                  className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
              </div>
              {hasFilters && (
                <button type="button"
                  onClick={() => { setFilterUserId(''); setFilterAction(''); setFilterFrom(''); setFilterTo(''); setSearch(''); setPage(1); }}
                  className="px-3 py-2 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg text-sm">
                  Сбросить
                </button>
              )}
            </div>
          </div>

          {/* Таблица */}
          <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-dark-700 flex items-center justify-between flex-wrap gap-2">
              <span className="text-dark-400 text-sm">
                Записей: <span className="text-white font-medium">{total}</span>
                {search && filteredLogs.length !== logs.length && (
                  <span className="text-dark-500 ml-2">(показано {filteredLogs.length})</span>
                )}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                    className="px-2.5 py-1.5 bg-dark-700 text-dark-300 rounded text-sm disabled:opacity-50 hover:bg-dark-600">←</button>
                  <span className="text-dark-400 text-sm">{page} / {totalPages}</span>
                  <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                    className="px-2.5 py-1.5 bg-dark-700 text-dark-300 rounded text-sm disabled:opacity-50 hover:bg-dark-600">→</button>
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
                      <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider w-[155px]">Когда</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider w-[120px]">Кто</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Действие</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Детали</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-700">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-12 text-center text-dark-500">
                          {!hasFilters ? 'Пока нет записей.' : 'Нет записей по фильтрам.'}
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log) => {
                        const ai = ACTION_LABELS[log.action];
                        return (
                          <tr key={log._id} className="hover:bg-dark-700/30">
                            <td className="px-4 py-2.5 text-dark-400 whitespace-nowrap text-xs">{formatDate(log.createdAt)}</td>
                            <td className="px-4 py-2.5">
                              <span className="text-white font-medium text-sm">{log.user?.name || '—'}</span>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1.5">
                                {ai?.icon && <span className="text-sm">{ai.icon}</span>}
                                <span className={`font-medium ${ai?.color || 'text-primary-400'}`}>{ai?.label || log.action}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 max-w-sm">{renderDetails(log) || <span className="text-dark-600">—</span>}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-dark-700 flex justify-center gap-2">
                <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                  className="px-3 py-1.5 bg-dark-700 text-dark-300 rounded text-sm disabled:opacity-50 hover:bg-dark-600">← Назад</button>
                <span className="px-3 py-1.5 text-dark-400 text-sm">Стр. {page} из {totalPages}</span>
                <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="px-3 py-1.5 bg-dark-700 text-dark-300 rounded text-sm disabled:opacity-50 hover:bg-dark-600">Вперёд →</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AuditLog;
