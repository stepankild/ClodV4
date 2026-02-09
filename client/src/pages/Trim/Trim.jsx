import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { useAuth } from '../../context/AuthContext';
import { trimService } from '../../services/trimService';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const fmt = (v, decimals = 1) => {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toFixed(decimals);
};

const formatLogDate = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const logDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((today - logDay) / (24 * 60 * 60 * 1000));
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};

const progressColor = (pct) => {
  if (pct >= 80) return 'bg-green-500';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-primary-500';
};

const Trim = () => {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission && hasPermission('trim:create');
  const canEdit = hasPermission && hasPermission('trim:edit');

  const [archives, setArchives] = useState([]);
  const [dailyStats, setDailyStats] = useState([]);
  const [statsDays, setStatsDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters & chart
  const [statusFilter, setStatusFilter] = useState('active');
  const [chartOpen, setChartOpen] = useState(false);

  // Inline log per card
  const [inlineWeights, setInlineWeights] = useState({});
  const [inlineStrains, setInlineStrains] = useState({});
  const [inlineSaving, setInlineSaving] = useState({});

  // Accordion logs per card
  const [expandedLogs, setExpandedLogs] = useState({});
  const [archiveLogs, setArchiveLogs] = useState({});
  const [archiveLogsLoading, setArchiveLogsLoading] = useState({});

  // Edit modal (strain data only)
  const [editModal, setEditModal] = useState(null);
  const [editStrainData, setEditStrainData] = useState([]);
  const [editSaving, setEditSaving] = useState(false);

  // ─── Data loading ───
  useEffect(() => { load(); }, [statusFilter]);

  useEffect(() => {
    if (chartOpen && dailyStats.length === 0) {
      trimService.getDailyStats(statsDays).then(d => setDailyStats(Array.isArray(d) ? d : [])).catch(() => {});
    }
  }, [chartOpen]);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const archivesData = await trimService.getActiveArchives(statusFilter);
      setArchives(Array.isArray(archivesData) ? archivesData : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  // ─── Metrics ───
  const calcMetrics = (a) => {
    const dry = a.harvestData?.dryWeight || 0;
    const trim = a.harvestData?.trimWeight || 0;
    const popcorn = a.harvestData?.popcornWeight || 0;
    const autoProgress = dry > 0 ? Math.min(100, Math.round(trim / dry * 100)) : 0;
    return {
      dry, trim, popcorn, autoProgress,
      lossPercent: dry > 0 ? ((dry - trim - popcorn) / dry) * 100 : null
    };
  };

  // ─── Inline log submit ───
  const handleInlineLog = async (archiveId) => {
    const weight = Number(inlineWeights[archiveId]);
    if (!weight || weight <= 0) return;

    const archive = archives.find(a => a._id === archiveId);
    const strainsList = (archive?.strains?.length) ? archive.strains : [archive?.strain || ''];
    const strain = strainsList.length === 1 ? null : (inlineStrains[archiveId] || '');

    if (strainsList.length > 1 && !strain) {
      setError('Выберите сорт');
      return;
    }

    setInlineSaving(prev => ({ ...prev, [archiveId]: true }));
    try {
      await trimService.addLog(archiveId, strain, weight, new Date().toISOString().slice(0, 10));
      setInlineWeights(prev => ({ ...prev, [archiveId]: '' }));
      await load();
      // Refresh logs if expanded
      if (expandedLogs[archiveId]) {
        const data = await trimService.getLogs(archiveId);
        setArchiveLogs(prev => ({ ...prev, [archiveId]: Array.isArray(data) ? data : [] }));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setInlineSaving(prev => ({ ...prev, [archiveId]: false }));
    }
  };

  // ─── Accordion logs toggle ───
  const toggleLogs = async (archiveId) => {
    const isOpen = !!expandedLogs[archiveId];
    setExpandedLogs(prev => ({ ...prev, [archiveId]: !isOpen }));

    if (!isOpen && !archiveLogs[archiveId]) {
      setArchiveLogsLoading(prev => ({ ...prev, [archiveId]: true }));
      try {
        const data = await trimService.getLogs(archiveId);
        setArchiveLogs(prev => ({ ...prev, [archiveId]: Array.isArray(data) ? data : [] }));
      } catch {
        setArchiveLogs(prev => ({ ...prev, [archiveId]: [] }));
      } finally {
        setArchiveLogsLoading(prev => ({ ...prev, [archiveId]: false }));
      }
    }
  };

  // ─── Delete log ───
  const handleDeleteLog = async (logId, archiveId) => {
    if (!confirm('Удалить запись трима?')) return;
    try {
      await trimService.deleteLog(logId);
      await load();
      if (expandedLogs[archiveId]) {
        const data = await trimService.getLogs(archiveId);
        setArchiveLogs(prev => ({ ...prev, [archiveId]: Array.isArray(data) ? data : [] }));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка удаления');
    }
  };

  // ─── Complete trim ───
  const handleCompleteTrim = async (archiveId) => {
    if (!confirm('Завершить трим? Архив уйдёт из списка «В работе».')) return;
    try {
      await trimService.completeTrim(archiveId);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  // ─── Edit modal ───
  const openEditModal = (archiveId) => {
    const arch = archives.find(a => a._id === archiveId);
    if (!arch) return;
    setEditModal(archiveId);
    setEditStrainData(
      Array.isArray(arch.strainData) && arch.strainData.length
        ? arch.strainData.map(s => ({ strain: s.strain || '', wetWeight: s.wetWeight ?? 0, dryWeight: s.dryWeight ?? 0, popcornWeight: s.popcornWeight ?? 0 }))
        : [{ strain: arch.strain || '', wetWeight: arch.harvestData?.wetWeight ?? 0, dryWeight: arch.harvestData?.dryWeight ?? 0, popcornWeight: arch.harvestData?.popcornWeight ?? 0 }]
    );
  };

  const handleSaveStrainData = async () => {
    if (!editModal) return;
    setEditSaving(true);
    try {
      const strainData = editStrainData
        .map(s => ({ strain: String(s.strain || '').trim(), wetWeight: Number(s.wetWeight) || 0, dryWeight: Number(s.dryWeight) || 0, popcornWeight: Number(s.popcornWeight) || 0 }))
        .filter(s => s.strain !== '');
      const dryTotal = strainData.reduce((sum, s) => sum + s.dryWeight, 0);
      const popcornTotal = strainData.reduce((sum, s) => sum + s.popcornWeight, 0);
      await trimService.updateArchive(editModal, {
        dryWeight: dryTotal,
        popcornWeight: popcornTotal,
        strainData: strainData.length ? strainData : undefined,
        strains: strainData.length ? strainData.map(s => s.strain) : undefined
      });
      setEditModal(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setEditSaving(false);
    }
  };

  // ─── Render ───
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  const tabs = [
    { key: 'active', label: 'В работе' },
    { key: 'completed', label: 'Завершённые' },
    { key: 'all', label: 'Все' }
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Трим</h1>
        <p className="text-dark-400 mt-1 text-sm">Записывайте вес за день прямо в карточке — прогресс считается автоматически.</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4 flex items-center gap-3">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-300 hover:text-white text-lg leading-none">&times;</button>
        </div>
      )}

      {/* Chart toggle */}
      <button
        type="button"
        onClick={() => setChartOpen(o => !o)}
        className="mb-4 px-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-dark-300 hover:text-white hover:border-dark-500 transition text-sm font-medium flex items-center gap-2"
      >
        <span>📊</span>
        <span>Статистика</span>
        <span className={`transition-transform ${chartOpen ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {chartOpen && (
        <div className="mb-6 bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-semibold text-white">Трим по дням</h2>
            <select
              value={statsDays}
              onChange={(e) => {
                const d = Number(e.target.value);
                setStatsDays(d);
                trimService.getDailyStats(d).then(data => setDailyStats(Array.isArray(data) ? data : [])).catch(() => {});
              }}
              className="px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
            >
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
            </select>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyStats.map(d => ({ ...d, day: new Date(d.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) }))} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 11 }} stroke="#6b7280" />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} stroke="#6b7280" unit=" г" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #4b5563', borderRadius: '8px' }}
                  labelStyle={{ color: '#d1d5db' }}
                  formatter={(value) => [`${Number(value).toFixed(0)} г`, 'Потримлено']}
                  labelFormatter={(_, payload) => payload[0]?.payload?.date ? formatDate(payload[0].payload.date) : ''}
                />
                <Bar dataKey="weight" fill="#22c55e" radius={[4, 4, 0, 0]} name="Потримлено" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setStatusFilter(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              statusFilter === t.key
                ? 'bg-primary-600 text-white'
                : 'bg-dark-800 text-dark-400 hover:bg-dark-700 hover:text-dark-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {archives.length === 0 && (
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-8 text-center text-dark-400">
          {statusFilter === 'active'
            ? 'Нет архивов в работе. Трим появится после сбора урожая.'
            : statusFilter === 'completed'
              ? 'Нет завершённых тримов.'
              : 'Нет архивов.'}
        </div>
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {archives.map(a => {
          const m = calcMetrics(a);
          const strainsList = (a.strains?.length) ? a.strains : [a.strain || ''];
          const isMultiStrain = strainsList.length > 1;
          const isSaving = !!inlineSaving[a._id];
          const isCompleted = a.trimStatus === 'completed';
          const logsOpen = !!expandedLogs[a._id];
          const cardLogs = archiveLogs[a._id] || [];
          const cardLogsLoading = !!archiveLogsLoading[a._id];

          return (
            <div key={a._id} className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
              {/* Header */}
              <div className="px-5 pt-4 pb-2 flex items-start justify-between">
                <div className="min-w-0">
                  <h3 className="text-white font-semibold truncate">{a.roomName}</h3>
                  <p className="text-dark-400 text-xs truncate">
                    {strainsList.join(' / ')} · {a.plantsCount || '?'} кустов
                    {a.harvestDate && <span className="text-dark-500"> · Сбор {formatDate(a.harvestDate)}</span>}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ml-2 ${
                  isCompleted ? 'bg-green-900/40 text-green-400'
                    : a.trimStatus === 'in_progress' ? 'bg-amber-900/40 text-amber-400'
                    : 'bg-dark-700 text-dark-400'
                }`}>
                  {isCompleted ? 'Готов' : a.trimStatus === 'in_progress' ? 'В работе' : 'Ожидает'}
                </span>
              </div>

              <div className="px-5 pb-4 space-y-3">
                {/* Key numbers */}
                <div className="flex gap-4 text-sm">
                  <div>
                    <span className="text-dark-500">Сухой: </span>
                    <span className="text-blue-400 font-medium">{m.dry > 0 ? `${fmt(m.dry, 0)}г` : '—'}</span>
                  </div>
                  <div>
                    <span className="text-dark-500">Потримлено: </span>
                    <span className="text-green-400 font-medium">{m.trim > 0 ? `${fmt(m.trim, 0)}г` : '—'}</span>
                  </div>
                  {m.popcorn > 0 && (
                    <div>
                      <span className="text-dark-500">Попкорн: </span>
                      <span className="text-amber-400">{fmt(m.popcorn, 0)}г</span>
                    </div>
                  )}
                </div>

                {/* Auto progress bar */}
                {m.dry > 0 && (
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-dark-400">Прогресс</span>
                      <span className={`font-medium ${m.autoProgress >= 80 ? 'text-green-400' : m.autoProgress >= 50 ? 'text-amber-400' : 'text-dark-300'}`}>
                        {m.autoProgress}%
                      </span>
                    </div>
                    <div className="h-2.5 bg-dark-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${progressColor(m.autoProgress)}`} style={{ width: `${m.autoProgress}%` }} />
                    </div>
                  </div>
                )}

                {/* Multi-strain pills */}
                {isMultiStrain && a.trimByStrain && Object.keys(a.trimByStrain).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {strainsList.map(s => (
                      <span key={s} className="px-2 py-0.5 bg-dark-700 rounded text-xs text-dark-300">
                        {s}: <span className="text-green-400">{a.trimByStrain[s] ? `${fmt(a.trimByStrain[s], 0)}г` : '0г'}</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* Inline log form */}
                {canCreate && !isCompleted && (
                  <div className="flex items-center gap-2">
                    {isMultiStrain && (
                      <select
                        value={inlineStrains[a._id] || ''}
                        onChange={e => setInlineStrains(prev => ({ ...prev, [a._id]: e.target.value }))}
                        className="px-2 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm min-w-0 flex-shrink"
                      >
                        <option value="">Сорт</option>
                        {strainsList.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    <input
                      type="number"
                      min="1"
                      placeholder="Вес (г)"
                      value={inlineWeights[a._id] || ''}
                      onChange={e => setInlineWeights(prev => ({ ...prev, [a._id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleInlineLog(a._id); } }}
                      className="w-24 px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                    />
                    <button
                      type="button"
                      disabled={isSaving || !inlineWeights[a._id]}
                      onClick={() => handleInlineLog(a._id)}
                      className="px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-40 text-sm font-medium whitespace-nowrap"
                    >
                      {isSaving ? '...' : 'Записать'}
                    </button>
                  </div>
                )}

                {/* Recent logs */}
                {a.recentLogs?.length > 0 && (
                  <div className="text-xs text-dark-400 flex flex-wrap gap-x-3 gap-y-0.5">
                    {a.recentLogs.map((log, i) => (
                      <span key={i}>
                        {formatLogDate(log.date)}: <span className="text-dark-300">{fmt(log.weight, 0)}г</span>
                        {isMultiStrain && log.strain && <span className="text-dark-500"> ({log.strain})</span>}
                      </span>
                    ))}
                  </div>
                )}

                {/* Loss % */}
                {m.autoProgress > 50 && m.lossPercent != null && m.dry > 0 && (
                  <div className="text-xs">
                    <span className="text-dark-500">Потеря: </span>
                    <span className="text-red-400">{fmt(m.lossPercent)}%</span>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2 pt-1 border-t border-dark-700">
                  <button
                    type="button"
                    onClick={() => toggleLogs(a._id)}
                    className="px-3 py-1.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded text-xs font-medium transition"
                  >
                    {logsOpen ? 'Свернуть ▴' : `Все записи ▸`}
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => openEditModal(a._id)}
                      className="px-2 py-1.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded text-xs transition"
                      title="Редактировать данные по сортам"
                    >
                      ⚙
                    </button>
                  )}
                  {canEdit && !isCompleted && (
                    <button
                      type="button"
                      onClick={() => handleCompleteTrim(a._id)}
                      className="px-3 py-1.5 bg-green-600/80 text-white rounded text-xs hover:bg-green-500 ml-auto font-medium"
                    >
                      ✓ Завершить
                    </button>
                  )}
                </div>

                {/* Accordion: full logs table */}
                {logsOpen && (
                  <div className="bg-dark-900 rounded-lg overflow-hidden">
                    {cardLogsLoading ? (
                      <div className="text-center text-dark-500 py-4 text-sm">Загрузка...</div>
                    ) : cardLogs.length === 0 ? (
                      <div className="text-center text-dark-500 py-4 text-sm">Нет записей</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-dark-400 text-xs uppercase">
                            <th className="px-3 py-2 text-left">Дата</th>
                            <th className="px-3 py-2 text-left">Сорт</th>
                            <th className="px-3 py-2 text-right">Вес</th>
                            <th className="px-3 py-2 text-left">Кто</th>
                            {canEdit && <th className="px-3 py-2 w-8" />}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-dark-700">
                          {cardLogs.map(log => (
                            <tr key={log._id} className="hover:bg-dark-800/50">
                              <td className="px-3 py-1.5 text-dark-300">{formatDate(log.date)}</td>
                              <td className="px-3 py-1.5 text-dark-300">{log.strain || '—'}</td>
                              <td className="px-3 py-1.5 text-right text-white font-medium">{log.weight}г</td>
                              <td className="px-3 py-1.5 text-dark-400">{log.createdBy?.name || '—'}</td>
                              {canEdit && (
                                <td className="px-3 py-1.5 text-right">
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteLog(log._id, a._id)}
                                    className="text-red-400 hover:text-red-300 text-xs"
                                  >
                                    &times;
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Edit Strain Data Modal ─── */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setEditModal(null)}>
          <div
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Данные по сортам</h3>
              <button type="button" onClick={() => setEditModal(null)} className="text-dark-400 hover:text-white text-xl">&times;</button>
            </div>

            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-dark-500 text-xs">
                    <th className="text-left py-1 pr-2">Сорт</th>
                    <th className="text-right py-1 px-1 w-20">Мокрый (г)</th>
                    <th className="text-right py-1 px-1 w-20">Сухой (г)</th>
                    <th className="text-right py-1 pl-1 w-20">Попкорн (г)</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {editStrainData.map((s, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-2">
                        <input
                          type="text"
                          value={s.strain}
                          onChange={e => setEditStrainData(prev => prev.map((r, j) => j === i ? { ...r, strain: e.target.value } : r))}
                          placeholder="Сорт"
                          className="w-full px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="number" min="0"
                          value={s.wetWeight}
                          onChange={e => setEditStrainData(prev => prev.map((r, j) => j === i ? { ...r, wetWeight: e.target.value } : r))}
                          className="w-full px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm text-right"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="number" min="0"
                          value={s.dryWeight}
                          onChange={e => setEditStrainData(prev => prev.map((r, j) => j === i ? { ...r, dryWeight: e.target.value } : r))}
                          className="w-full px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm text-right"
                        />
                      </td>
                      <td className="py-1 pl-1">
                        <input
                          type="number" min="0"
                          value={s.popcornWeight}
                          onChange={e => setEditStrainData(prev => prev.map((r, j) => j === i ? { ...r, popcornWeight: e.target.value } : r))}
                          className="w-full px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm text-right"
                        />
                      </td>
                      <td className="py-1 pl-1">
                        <button
                          type="button"
                          onClick={() => setEditStrainData(prev => prev.filter((_, j) => j !== i))}
                          className="text-red-400 hover:text-red-300 text-lg leading-none"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={() => setEditStrainData(prev => [...prev, { strain: '', wetWeight: 0, dryWeight: 0, popcornWeight: 0 }])}
              className="text-xs text-primary-400 hover:text-primary-300 mb-4"
            >
              + Добавить сорт
            </button>

            <div className="flex gap-2 pt-3 border-t border-dark-700">
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg text-sm"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSaveStrainData}
                disabled={editSaving}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50 text-sm ml-auto"
              >
                {editSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Trim;
