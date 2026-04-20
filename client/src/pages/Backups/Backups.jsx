import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBackups } from '../../hooks/useBackups';

function formatDateTime(iso, locale) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(locale, {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

function formatDuration(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function formatSize(mb) {
  if (mb == null) return '—';
  return `${mb.toFixed(2)} MB`;
}

const STATUS_COLORS = {
  ok:      'bg-green-700/50 text-green-400',
  failed:  'bg-red-700/50 text-red-400',
  running: 'bg-blue-700/50 text-blue-400',
  pending: 'bg-dark-700 text-dark-400',
};

export default function Backups() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';
  const { list, agentOnline, loading, run } = useBackups();
  const [busy, setBusy] = useState(null);   // 'weekly' | 'monthly' | null
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const handleRun = async (type) => {
    setError(null);
    setBusy(type);
    try {
      await run(type);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 503) setError(t('backups.errors.agentOffline'));
      else if (status === 409) setError(t('backups.errors.conflict'));
      else setError(t('backups.errors.generic'));
    } finally {
      setBusy(null);
    }
  };

  // Есть ли сейчас running/pending бэкап — блокируем кнопки
  const anyRunning = list.some((b) => ['pending', 'running'].includes(b.status));
  const disabled = !agentOnline || !!busy || anyRunning;

  return (
    <div className="p-6 max-w-6xl mx-auto text-white">
      <h1 className="text-2xl font-bold mb-1">{t('backups.title')}</h1>
      <p className="text-sm text-dark-400 mb-4">{t('backups.description')}</p>

      {/* Agent status + buttons */}
      <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${agentOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-sm">
            {t('backups.agent')}: <span className={agentOnline ? 'text-green-400' : 'text-red-400'}>
              {agentOnline ? t('backups.agentOnline') : t('backups.agentOffline')}
            </span>
          </span>
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => handleRun('weekly')}
          disabled={disabled}
          className="px-4 py-2 bg-primary-700 hover:bg-primary-600 text-white rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === 'weekly' ? t('backups.running') : t('backups.runWeekly')}
        </button>
        <button
          type="button"
          onClick={() => handleRun('monthly')}
          disabled={disabled}
          className="px-4 py-2 bg-primary-700 hover:bg-primary-600 text-white rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === 'monthly' ? t('backups.running') : t('backups.runMonthly')}
        </button>
      </div>

      {!agentOnline && (
        <div className="mb-4 text-xs text-dark-400">
          {t('backups.agentOfflineHint')}
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 rounded bg-red-900/40 border border-red-800 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-dark-800 rounded-lg border border-dark-700 overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-dark-400 text-sm">...</div>
        ) : list.length === 0 ? (
          <div className="p-6 text-center text-dark-400 text-sm">{t('backups.empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-dark-900">
              <tr>
                <th className="px-4 py-2 text-left text-xs text-dark-400 font-normal">{t('backups.cols.when')}</th>
                <th className="px-4 py-2 text-left text-xs text-dark-400 font-normal">{t('backups.cols.type')}</th>
                <th className="px-4 py-2 text-left text-xs text-dark-400 font-normal">{t('backups.cols.status')}</th>
                <th className="px-4 py-2 text-right text-xs text-dark-400 font-normal">{t('backups.cols.duration')}</th>
                <th className="px-4 py-2 text-right text-xs text-dark-400 font-normal">{t('backups.cols.size')}</th>
                <th className="px-4 py-2 text-left text-xs text-dark-400 font-normal">{t('backups.cols.triggeredBy')}</th>
                <th className="px-4 py-2 text-right text-xs text-dark-400 font-normal">{t('backups.cols.warnings')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {list.map((b) => {
                const isExpanded = expandedId === b._id;
                const statusClass = STATUS_COLORS[b.status] || 'bg-dark-700 text-dark-400';
                const typeLabel = t(`backups.typeLabels.${b.type}`, b.type);
                const statusLabel = t(`backups.statusLabels.${b.status}`, b.status);
                const by = b.triggeredByName || (b.triggeredBy === 'schedule' ? t('backups.triggerSchedule') : '—');
                const wcount = Array.isArray(b.warnings) ? b.warnings.length : 0;
                return (
                  <>
                    <tr
                      key={b._id}
                      className="hover:bg-dark-700/30 cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : b._id)}
                    >
                      <td className="px-4 py-2 text-dark-300 text-xs whitespace-nowrap">
                        {formatDateTime(b.startedAt, locale)}
                      </td>
                      <td className="px-4 py-2 text-dark-300 text-xs">{typeLabel}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 text-xs rounded ${statusClass}`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-dark-300 text-xs">{formatDuration(b.durationSec)}</td>
                      <td className="px-4 py-2 text-right text-dark-300 text-xs">{formatSize(b.sizeMB)}</td>
                      <td className="px-4 py-2 text-dark-400 text-xs">{by}</td>
                      <td className="px-4 py-2 text-right text-xs">
                        {wcount > 0 ? <span className="text-amber-400">{wcount}</span> : <span className="text-dark-600">0</span>}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${b._id}-details`} className="bg-dark-900/60">
                        <td colSpan={7} className="px-4 py-3 text-xs text-dark-300">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {b.sections && typeof b.sections === 'object' && (
                              <div>
                                <div className="text-dark-500 font-semibold mb-1">{t('backups.details.sections')}</div>
                                <ul className="space-y-0.5">
                                  {Object.entries(b.sections).map(([k, v]) => (
                                    <li key={k} className="flex justify-between">
                                      <span className="text-dark-400">{k}</span>
                                      <span>{String(v)}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <div>
                              {b.gitSha && (
                                <div className="mb-2">
                                  <span className="text-dark-500 font-semibold">{t('backups.details.git')}: </span>
                                  <code className="text-dark-300">{b.gitBranch || '?'}@{String(b.gitSha).slice(0, 10)}</code>
                                </div>
                              )}
                              {wcount > 0 && (
                                <div className="mb-2">
                                  <div className="text-dark-500 font-semibold mb-1">{t('backups.details.warnings')}</div>
                                  <ul className="list-disc pl-4 text-amber-300/80">
                                    {b.warnings.map((w, i) => <li key={i}>{w}</li>)}
                                  </ul>
                                </div>
                              )}
                              {b.errorMessage && (
                                <div>
                                  <div className="text-dark-500 font-semibold mb-1">{t('backups.details.error')}</div>
                                  <code className="text-red-400 break-all">{b.errorMessage}</code>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
