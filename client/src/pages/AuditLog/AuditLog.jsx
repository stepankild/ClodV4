import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { auditLogService } from '../../services/auditLogService';
import { userService } from '../../services/userService';

// Icons and colors for actions (no translation needed)
const ACTION_META = {
  'auth.login': { icon: '🔑', color: 'text-green-400' },
  'auth.logout': { icon: '🚪', color: 'text-dark-400' },
  'auth.change_password': { icon: '🔐', color: 'text-yellow-400' },
  'user.create': { icon: '👤', color: 'text-blue-400' },
  'user.update': { icon: '✏️', color: 'text-yellow-400' },
  'user.approve': { icon: '✅', color: 'text-green-400' },
  'user.delete': { icon: '🗑️', color: 'text-red-400' },
  'user.restore': { icon: '♻️', color: 'text-green-400' },
  'role.create': { icon: '🛡️', color: 'text-blue-400' },
  'role.update': { icon: '🛡️', color: 'text-yellow-400' },
  'role.delete': { icon: '🛡️', color: 'text-red-400' },
  'role.restore': { icon: '🛡️', color: 'text-green-400' },
  'room.update': { icon: '🏠', color: 'text-yellow-400' },
  'room.cycle_start': { icon: '🌱', color: 'text-green-400' },
  'room.cycle_transfer': { icon: '➡️', color: 'text-blue-400' },
  'room.note': { icon: '📝', color: 'text-blue-400' },
  'room.harvest_reset': { icon: '🏠', color: 'text-orange-400' },
  'task.create': { icon: '📋', color: 'text-blue-400' },
  'task.quick_add': { icon: '⚡', color: 'text-blue-400' },
  'task.complete': { icon: '✅', color: 'text-green-400' },
  'task.uncomplete': { icon: '↩️', color: 'text-yellow-400' },
  'task.update': { icon: '📋', color: 'text-yellow-400' },
  'task.delete': { icon: '🗑️', color: 'text-red-400' },
  'task.restore': { icon: '♻️', color: 'text-green-400' },
  'clone_cut.create_order': { icon: '🌿', color: 'text-blue-400' },
  'clone_cut.create': { icon: '✂️', color: 'text-green-400' },
  'clone_cut.upsert': { icon: '✂️', color: 'text-green-400' },
  'clone_cut.update': { icon: '✂️', color: 'text-yellow-400' },
  'clone_cut.delete': { icon: '🗑️', color: 'text-red-400' },
  'clone_cut.restore': { icon: '♻️', color: 'text-green-400' },
  'clone_cut.dispose': { icon: '🗑️', color: 'text-orange-400' },
  'veg_batch.create': { icon: '🌱', color: 'text-green-400' },
  'veg_batch.update': { icon: '🌱', color: 'text-yellow-400' },
  'veg_batch.dispose_remaining': { icon: '🌱', color: 'text-orange-400' },
  'veg_batch.delete': { icon: '🗑️', color: 'text-red-400' },
  'veg_batch.restore': { icon: '♻️', color: 'text-green-400' },
  'harvest.session_start': { icon: '⚖️', color: 'text-blue-400' },
  'harvest.plant_add': { icon: '🌿', color: 'text-green-400' },
  'harvest.plant_remove': { icon: '🌿', color: 'text-red-400' },
  'harvest.complete': { icon: '🎉', color: 'text-green-400' },
  'harvest.archive': { icon: '📦', color: 'text-blue-400' },
  'trim.log_add': { icon: '✂️', color: 'text-green-400' },
  'trim.log_delete': { icon: '🗑️', color: 'text-red-400' },
  'trim.log_restore': { icon: '♻️', color: 'text-green-400' },
  'trim.archive_update': { icon: '✂️', color: 'text-yellow-400' },
  'trim.complete': { icon: '✅', color: 'text-green-400' },
  'archive.update': { icon: '📦', color: 'text-yellow-400' },
  'archive.delete': { icon: '🗑️', color: 'text-red-400' },
  'archive.restore': { icon: '♻️', color: 'text-green-400' },
  'plan.upsert': { icon: '📅', color: 'text-blue-400' },
  'plan.update': { icon: '📅', color: 'text-yellow-400' },
  'plan.delete': { icon: '🗑️', color: 'text-red-400' },
  'plan.restore': { icon: '♻️', color: 'text-green-400' },
  'roomTemplate.create': { icon: '📐', color: 'text-blue-400' },
  'roomTemplate.delete': { icon: '🗑️', color: 'text-red-400' },
  'roomTemplate.restore': { icon: '♻️', color: 'text-green-400' },
  // Сорта
  'strain.create': { icon: '🧬', color: 'text-blue-400' },
  'strain.update': { icon: '🧬', color: 'text-yellow-400' },
  'strain.delete': { icon: '🗑️', color: 'text-red-400' },
  'strain.restore': { icon: '♻️', color: 'text-green-400' },
  'strain.merge': { icon: '🔀', color: 'text-yellow-400' },
  'strain.migrate': { icon: '🧬', color: 'text-blue-400' },
  // Материнские растения
  'mother_plant.create': { icon: '🌳', color: 'text-blue-400' },
  'mother_plant.update': { icon: '🌳', color: 'text-yellow-400' },
  'mother_plant.prune': { icon: '✂️', color: 'text-yellow-400' },
  'mother_plant.retire': { icon: '🌳', color: 'text-orange-400' },
  'mother_plant.delete': { icon: '🗑️', color: 'text-red-400' },
  'mother_plant.restore': { icon: '♻️', color: 'text-green-400' },
  // Обработки
  'treatment.create': { icon: '💊', color: 'text-blue-400' },
  'treatment.update': { icon: '💊', color: 'text-yellow-400' },
  'treatment.complete': { icon: '✅', color: 'text-green-400' },
  'treatment.skip': { icon: '⏭️', color: 'text-yellow-400' },
  'treatment.delete': { icon: '🗑️', color: 'text-red-400' },
  'treatment.restore': { icon: '♻️', color: 'text-green-400' },
  'treatment_product.create': { icon: '🧪', color: 'text-blue-400' },
  'treatment_product.update': { icon: '🧪', color: 'text-yellow-400' },
  'treatment_product.delete': { icon: '🗑️', color: 'text-red-400' },
  'treatment_product.restore': { icon: '♻️', color: 'text-green-400' },
  'treatment_protocol.create': { icon: '📋', color: 'text-blue-400' },
  'treatment_protocol.update': { icon: '📋', color: 'text-yellow-400' },
  'treatment_protocol.delete': { icon: '🗑️', color: 'text-red-400' },
  'treatment_protocol.set_default': { icon: '⭐', color: 'text-yellow-400' },
  'treatment_schedule.apply': { icon: '📅', color: 'text-blue-400' },
  'treatment_schedule.complete': { icon: '✅', color: 'text-green-400' },
};

// Action groups for filter (keys only — labels come from t())
const ACTION_GROUP_KEYS = [
  { groupKey: 'auth', options: ['auth.login', 'auth.logout', 'auth.change_password'] },
  { groupKey: 'users', options: ['user.create', 'user.update', 'user.approve', 'user.delete', 'user.restore'] },
  { groupKey: 'roles', options: ['role.create', 'role.update', 'role.delete', 'role.restore'] },
  { groupKey: 'rooms', options: ['room.update', 'room.cycle_start', 'room.cycle_transfer', 'room.note', 'room.harvest_reset'] },
  { groupKey: 'tasks', options: ['task.create', 'task.quick_add', 'task.complete', 'task.uncomplete', 'task.update', 'task.delete', 'task.restore'] },
  { groupKey: 'clones', options: ['clone_cut.create', 'clone_cut.create_order', 'clone_cut.upsert', 'clone_cut.update', 'clone_cut.delete', 'clone_cut.restore', 'clone_cut.dispose'] },
  { groupKey: 'vegetation', options: ['veg_batch.create', 'veg_batch.update', 'veg_batch.dispose_remaining', 'veg_batch.delete', 'veg_batch.restore'] },
  { groupKey: 'harvest', options: ['harvest.session_start', 'harvest.plant_add', 'harvest.plant_remove', 'harvest.complete', 'harvest.archive'] },
  { groupKey: 'trim', options: ['trim.log_add', 'trim.log_delete', 'trim.log_restore', 'trim.archive_update', 'trim.complete'] },
  { groupKey: 'archive', options: ['archive.update', 'archive.delete', 'archive.restore'] },
  { groupKey: 'plans', options: ['plan.upsert', 'plan.update', 'plan.delete', 'plan.restore'] },
  { groupKey: 'templates', options: ['roomTemplate.create', 'roomTemplate.delete', 'roomTemplate.restore'] },
  { groupKey: 'strains', options: ['strain.create', 'strain.update', 'strain.delete', 'strain.restore', 'strain.merge', 'strain.migrate'] },
  { groupKey: 'mothers', options: ['mother_plant.create', 'mother_plant.update', 'mother_plant.prune', 'mother_plant.retire', 'mother_plant.delete', 'mother_plant.restore'] },
  { groupKey: 'treatments', options: ['treatment.create', 'treatment.update', 'treatment.complete', 'treatment.skip', 'treatment.delete', 'treatment.restore', 'treatment_product.create', 'treatment_product.update', 'treatment_product.delete', 'treatment_product.restore', 'treatment_protocol.create', 'treatment_protocol.update', 'treatment_protocol.delete', 'treatment_protocol.set_default', 'treatment_schedule.apply', 'treatment_schedule.complete'] },
];

const AuditLog = () => {
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();

  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';

  const formatDate = (date) => {
    if (!date) return '—';
    return new Date(date).toLocaleString(locale, {
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
    return new Date(date).toLocaleString(locale, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDuration = (ms) => {
    if (!ms || ms < 0) return '—';
    const totalMin = Math.floor(ms / 60000);
    if (totalMin < 1) return t('audit.lessThan1m');
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    const parts = [];
    if (days > 0) parts.push(`${days}${t('audit.daysShort')}`);
    if (hours > 0) parts.push(`${hours}${t('audit.hoursShort')}`);
    if (mins > 0) parts.push(`${mins}${t('audit.minutesShort')}`);
    return parts.join(' ') || t('audit.lessThan1m');
  };

  const timeAgo = (date) => {
    if (!date) return '—';
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('audit.justNow');
    if (mins < 60) return t('audit.minsAgo', { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('audit.hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    return t('audit.daysAgo', { count: days });
  };

  const getActionLabel = (action) => {
    return t(`audit.actionLabels.${action}`, { defaultValue: action });
  };

  const getDetailLabel = (key) => {
    return t(`audit.detailLabels.${key}`, { defaultValue: key });
  };

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
      // Включаем удалённых — чтобы можно было фильтровать по уволенным в истории аудита
      const list = await userService.getUsers({ includeDeleted: true });
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
      if (!silent) setSessionsError(err.response?.data?.message || err.message || t('audit.sessionsLoadError'));
    } finally {
      if (!silent) setSessionsLoading(false);
    }
  }, [t]);

  const loadLogs = async () => {
    try {
      setLoading(true);
      setError('');
      const params = { page, limit };
      if (filterUserId) params.userId = filterUserId;
      if (filterAction) params.action = filterAction;
      if (filterFrom) params.from = filterFrom;
      if (filterTo) params.to = filterTo;
      if (search.trim()) params.search = search.trim();
      const data = await auditLogService.getLogs(params);
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err.response?.data?.message || err.message || t('audit.logLoadError'));
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

  // Auto-refresh sessions every 30 seconds — пауза когда таб скрыт (document.hidden)
  useEffect(() => {
    if (!canRead || activeTab !== 'sessions') return;
    const tick = () => { if (!document.hidden) loadSessions(true); };
    const interval = setInterval(tick, 30_000);
    const onVisible = () => { if (!document.hidden) loadSessions(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [canRead, activeTab, loadSessions]);

  // Серверный поиск — дебаунс 400 мс, сбрасываем страницу
  useEffect(() => {
    if (!canRead || activeTab !== 'log') return;
    const handle = setTimeout(() => { setPage(1); loadLogs(); }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (canRead && activeTab === 'log') loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, activeTab, page, filterUserId, filterAction, filterFrom, filterTo]);

  if (!canRead) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center text-dark-400">
          <p className="text-lg font-medium">{t('audit.noAccess')}</p>
          <p className="text-sm mt-1">{t('audit.needPermission')}</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(total / limit);
  // Поиск теперь серверный — работаем прямо со списком с бэкенда
  const filteredLogs = logs;

  // Render details
  const renderDetails = (log) => {
    if (!log.details || Object.keys(log.details).length === 0) return null;
    const entries = Object.entries(log.details).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (entries.length === 0) return null;

    return (
      <div className="text-xs space-y-0.5">
        {entries.map(([key, value]) => {
          const label = getDetailLabel(key);
          let displayValue = value;
          if (typeof value === 'boolean') displayValue = value ? t('common.yes') : t('common.no');
          else if (key.endsWith('Weight') || key === 'weight') displayValue = `${value}${t('common.grams')}`;
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
        <h1 className="text-2xl font-bold text-white">{t('audit.title')}</h1>
        <p className="text-dark-400 mt-1">{t('audit.subtitle')}</p>
      </div>

      {/* Tabs */}
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
          {t('audit.sessionsTab')}
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
          {t('audit.logTab')}
        </button>
      </div>

      {/* ===== TAB: SESSIONS ===== */}
      {activeTab === 'sessions' && (
        <>
          {sessionsError && (
            <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex items-center gap-3">
              <span>{sessionsError}</span>
              <button type="button" onClick={loadSessions} className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium">{t('common.retry')}</button>
            </div>
          )}

          {sessionsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500" />
            </div>
          ) : (
            <>
              {/* Active sessions */}
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                  {t('audit.activeSessions', { count: sessions.activeSessions.length })}
                  <span className="text-xs text-dark-500 font-normal ml-1">
                    {t('audit.onlineCount', { count: sessions.activeSessions.filter(s => s.isOnline).length })}
                  </span>
                  <button
                    type="button"
                    onClick={() => loadSessions()}
                    className="ml-auto p-1.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg transition"
                    title={t('audit.refresh')}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </h2>

                {sessions.activeSessions.length === 0 ? (
                  <div className="bg-dark-800 rounded-xl border border-dark-700 p-8 text-center text-dark-500">
                    {t('audit.noActiveSessions')}
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
                            {s.isOnline ? t('audit.online') : t('audit.inactive')}
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
                              <span className="text-dark-500">{t('audit.lastSeen')}</span>
                              <span className="text-yellow-500/80">{timeAgo(s.lastActivity)}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-dark-500">{t('audit.loginTime')}</span>
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
                            <span className="text-dark-500">{t('audit.browser')}</span>
                            <span className="text-dark-300">{s.browser} · {s.os}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-dark-500">{t('audit.session')}</span>
                            <span className={`font-medium ${s.isOnline ? 'text-green-400' : 'text-dark-300'}`}>{formatDuration(s.duration)}</span>
                          </div>
                          {s.totalTime > 0 && (
                            <div className="flex justify-between">
                              <span className="text-dark-500">{t('audit.totalInSystem')}</span>
                              <span className="text-primary-400 font-medium">{formatDuration(s.totalTime)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Login history */}
              <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-dark-700">
                  <span className="text-white font-medium text-sm">{t('audit.loginHistory')}</span>
                  <span className="text-dark-500 text-sm ml-2">({sessions.loginHistory.length})</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-dark-900">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('audit.userCol')}</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('audit.loginCol')}</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('audit.logoutCol')}</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('audit.durationCol')}</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('audit.ipCol')}</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('audit.browserCol')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-700">
                      {sessions.loginHistory.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-12 text-center text-dark-500">{t('audit.noRecords')}</td>
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
                                  {t('audit.online')}
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

      {/* ===== TAB: ACTION LOG ===== */}
      {activeTab === 'log' && (
        <>
          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex items-center gap-3">
              <span>{error}</span>
              <button type="button" onClick={loadLogs} className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium">{t('common.retry')}</button>
            </div>
          )}

          {/* Filters */}
          <div className="bg-dark-800 rounded-xl border border-dark-700 p-4 mb-6">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-dark-500 mb-1">{t('audit.search')}</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('audit.searchPlaceholder')}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm placeholder-dark-500"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-500 mb-1">{t('audit.userFilter')}</label>
                <select
                  value={filterUserId}
                  onChange={(e) => { setFilterUserId(e.target.value); setPage(1); }}
                  className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm min-w-[150px]"
                >
                  <option value="">{t('common.all')}</option>
                  {users.map((u) => (
                    <option key={u._id} value={u._id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-dark-500 mb-1">{t('audit.actionFilter')}</label>
                <select
                  value={filterAction}
                  onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
                  className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm min-w-[190px]"
                >
                  <option value="">{t('common.all')}</option>
                  {ACTION_GROUP_KEYS.map((group) => (
                    <optgroup key={group.groupKey} label={t(`audit.actionGroups.${group.groupKey}`)}>
                      {group.options.map((a) => (
                        <option key={a} value={a}>{getActionLabel(a)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-dark-500 mb-1">{t('audit.fromDate')}</label>
                <input type="date" value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
                  className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
              </div>
              <div>
                <label className="block text-xs text-dark-500 mb-1">{t('audit.toDate')}</label>
                <input type="date" value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
                  className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
              </div>
              {hasFilters && (
                <button type="button"
                  onClick={() => { setFilterUserId(''); setFilterAction(''); setFilterFrom(''); setFilterTo(''); setSearch(''); setPage(1); }}
                  className="px-3 py-2 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg text-sm">
                  {t('audit.resetFilters')}
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-dark-700 flex items-center justify-between flex-wrap gap-2">
              <span className="text-dark-400 text-sm">
                {t('audit.records')} <span className="text-white font-medium">{total}</span>
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                    className="px-2.5 py-1.5 bg-dark-700 text-dark-300 rounded text-sm disabled:opacity-50 hover:bg-dark-600">←</button>
                  <span className="text-dark-400 text-sm">{t('audit.pageOf', { current: page, total: totalPages })}</span>
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
                      <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider w-[155px]">{t('audit.whenCol')}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider w-[120px]">{t('audit.whoCol')}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('audit.actionCol')}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">{t('audit.detailsCol')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-700">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-12 text-center text-dark-500">
                          {!hasFilters ? t('audit.noRecordsEmpty') : t('audit.noRecordsFiltered')}
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log) => {
                        const ai = ACTION_META[log.action];
                        return (
                          <tr key={log._id} className="hover:bg-dark-700/30">
                            <td className="px-4 py-2.5 text-dark-400 whitespace-nowrap text-xs">{formatDate(log.createdAt)}</td>
                            <td className="px-4 py-2.5">
                              <span className="text-white font-medium text-sm">{log.user?.name || '—'}</span>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1.5">
                                {ai?.icon && <span className="text-sm">{ai.icon}</span>}
                                <span className={`font-medium ${ai?.color || 'text-primary-400'}`}>{getActionLabel(log.action)}</span>
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
                  className="px-3 py-1.5 bg-dark-700 text-dark-300 rounded text-sm disabled:opacity-50 hover:bg-dark-600">{t('audit.prev')}</button>
                <span className="px-3 py-1.5 text-dark-400 text-sm">{t('audit.page', { current: page, total: totalPages })}</span>
                <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="px-3 py-1.5 bg-dark-700 text-dark-300 rounded text-sm disabled:opacity-50 hover:bg-dark-600">{t('audit.next')}</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AuditLog;
