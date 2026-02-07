import { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
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

const Trim = () => {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission && hasPermission('trim:create');
  const canEdit = hasPermission && hasPermission('trim:edit');

  const [archives, setArchives] = useState([]);
  const [dailyStats, setDailyStats] = useState([]);
  const [statsDays, setStatsDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Daily log form
  const [logForm, setLogForm] = useState({ archiveId: '', strain: '', weight: '', date: new Date().toISOString().slice(0, 10) });
  const [logSaving, setLogSaving] = useState(false);

  // Detail modal
  const [selectedArchive, setSelectedArchive] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Edit fields inside detail modal
  const [editDry, setEditDry] = useState('');
  const [editPopcorn, setEditPopcorn] = useState('');
  const [editProgressPercent, setEditProgressPercent] = useState('');
  const [editStrainData, setEditStrainData] = useState([]);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [archivesData, statsData] = await Promise.all([
        trimService.getActiveArchives(),
        trimService.getDailyStats(statsDays)
      ]);
      setArchives(Array.isArray(archivesData) ? archivesData : []);
      setDailyStats(Array.isArray(statsData) ? statsData : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  // ─── Daily log ───
  const handleLogSubmit = async (e) => {
    e.preventDefault();
    if (!logForm.archiveId || !logForm.strain || !logForm.weight) return;
    setLogSaving(true);
    try {
      await trimService.addLog(logForm.archiveId, logForm.strain, Number(logForm.weight), logForm.date);
      setLogForm(f => ({ ...f, weight: '' }));
      await load();
      // refresh detail modal if open
      if (selectedArchive && selectedArchive._id === logForm.archiveId) {
        await openDetail(logForm.archiveId);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setLogSaving(false);
    }
  };

  // ─── Detail modal ───
  const openDetail = async (archiveId) => {
    const arch = archives.find(a => a._id === archiveId);
    if (!arch) return;
    setSelectedArchive(arch);
    setEditDry(String(arch.harvestData?.dryWeight || 0));
    setEditPopcorn(String(arch.harvestData?.popcornWeight || 0));
    setEditProgressPercent(String(arch.harvestData?.trimProgressPercent ?? 0));
    setEditStrainData(Array.isArray(arch.strainData) && arch.strainData.length
      ? arch.strainData.map(s => ({ strain: s.strain || '', wetWeight: s.wetWeight ?? 0, dryWeight: s.dryWeight ?? 0, popcornWeight: s.popcornWeight ?? 0 }))
      : [{ strain: arch.strain || '', wetWeight: arch.harvestData?.wetWeight ?? 0, dryWeight: arch.harvestData?.dryWeight ?? 0, popcornWeight: arch.harvestData?.popcornWeight ?? 0 }]);
    setLogsLoading(true);
    try {
      const data = await trimService.getLogs(archiveId);
      setLogs(Array.isArray(data) ? data : []);
    } catch { setLogs([]); }
    finally { setLogsLoading(false); }
  };

  const closeDetail = () => { setSelectedArchive(null); setLogs([]); };

  const handleDeleteLog = async (logId) => {
    if (!confirm('Удалить запись трима?')) return;
    try {
      await trimService.deleteLog(logId);
      await load();
      if (selectedArchive) await openDetail(selectedArchive._id);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка удаления');
    }
  };

  const handleSaveFields = async () => {
    if (!selectedArchive) return;
    setEditSaving(true);
    try {
      const strainData = editStrainData.map(s => ({
        strain: String(s.strain || '').trim(),
        wetWeight: Number(s.wetWeight) || 0,
        dryWeight: Number(s.dryWeight) || 0,
        popcornWeight: Number(s.popcornWeight) || 0
      })).filter(s => s.strain !== '');
      const dryTotal = strainData.reduce((sum, s) => sum + (s.dryWeight || 0), 0);
      const popcornTotal = strainData.reduce((sum, s) => sum + (s.popcornWeight || 0), 0);
      await trimService.updateArchive(selectedArchive._id, {
        dryWeight: dryTotal,
        popcornWeight: popcornTotal,
        trimProgressPercent: Math.min(100, Math.max(0, Number(editProgressPercent) || 0)),
        strainData: strainData.length ? strainData : undefined,
        strains: strainData.length ? strainData.map(s => s.strain) : undefined
      });
      await load();
      const updated = (await trimService.getActiveArchives()).find(a => a._id === selectedArchive._id);
      if (updated) {
        setSelectedArchive(updated);
        setEditDry(String(updated.harvestData?.dryWeight || 0));
        setEditPopcorn(String(updated.harvestData?.popcornWeight || 0));
        setEditProgressPercent(String(updated.harvestData?.trimProgressPercent ?? 0));
        setEditStrainData(Array.isArray(updated.strainData) && updated.strainData.length
          ? updated.strainData.map(s => ({ strain: s.strain || '', wetWeight: s.wetWeight ?? 0, dryWeight: s.dryWeight ?? 0, popcornWeight: s.popcornWeight ?? 0 }))
          : [{ strain: updated.strain || '', wetWeight: updated.harvestData?.wetWeight ?? 0, dryWeight: updated.harvestData?.dryWeight ?? 0, popcornWeight: updated.harvestData?.popcornWeight ?? 0 }]);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setEditSaving(false);
    }
  };

  const handleCompleteTrim = async (archiveId) => {
    if (!confirm('Завершить трим? Архив уйдёт из этого списка.')) return;
    try {
      await trimService.completeTrim(archiveId);
      closeDetail();
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  // ─── Calculations ───
  const calcMetrics = (a) => {
    const dry = a.harvestData?.dryWeight || 0;
    const trim = a.harvestData?.trimWeight || 0;
    const popcorn = a.harvestData?.popcornWeight || 0;
    const sqm = a.squareMeters || 0;
    const progressPercent = Math.min(100, Math.max(0, Number(a.harvestData?.trimProgressPercent) || 0));
    return {
      dry,
      trim,
      popcorn,
      sqm,
      progressPercent,
      dryPerSqm: sqm > 0 ? dry / sqm : null,
      trimPerSqm: sqm > 0 ? trim / sqm : null,
      trimPercent: dry > 0 ? (trim / dry) * 100 : 0,
      lossPercent: dry > 0 ? ((dry - trim - popcorn) / dry) * 100 : null
    };
  };

  // ─── Render ───
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Трим</h1>
        <p className="text-dark-400 mt-1">Тримление после сбора урожая. Записывайте вес за день — он автоматически суммируется.</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4 flex items-center gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => { setError(''); load(); }} className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium">Повторить</button>
        </div>
      )}

      {/* ─── График: трим по дням ─── */}
      <div className="mb-6 bg-dark-800 rounded-xl border border-dark-700 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-sm font-semibold text-white">Трим по дням</h2>
          <select
            value={statsDays}
            onChange={(e) => {
              const d = Number(e.target.value);
              setStatsDays(d);
              trimService.getDailyStats(d).then((data) => setDailyStats(Array.isArray(data) ? data : []));
            }}
            className="px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
          >
            <option value={7}>7 дней</option>
            <option value={30}>30 дней (месяц)</option>
            <option value={90}>90 дней</option>
          </select>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={dailyStats.map((d) => ({ ...d, day: new Date(d.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) }))}
              margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
            >
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

      {/* ─── Форма быстрого ввода ─── */}
      {canCreate && archives.filter((a) => a.trimStatus !== 'completed').length > 0 && (
        <div className="mb-6 bg-dark-800 rounded-xl border border-dark-700 p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Записать трим за день</h2>
          <form onSubmit={handleLogSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs text-dark-400 mb-1">Комната</label>
              <select
                value={logForm.archiveId}
                onChange={(e) => setLogForm(f => ({ ...f, archiveId: e.target.value, strain: '' }))}
                required
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
              >
                <option value="">— Выберите —</option>
                {archives.filter((a) => a.trimStatus !== 'completed').map(a => (
                  <option key={a._id} value={a._id}>{a.roomName} · {(a.strains && a.strains.length) ? a.strains.join(', ') : a.strain}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs text-dark-400 mb-1">Сорт</label>
              <select
                value={logForm.strain}
                onChange={(e) => setLogForm(f => ({ ...f, strain: e.target.value }))}
                required
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
              >
                <option value="">— Выберите —</option>
                {(() => {
                  const arch = archives.find(a => a._id === logForm.archiveId);
                  const list = (arch?.strains && arch.strains.length) ? arch.strains : (arch ? [arch.strain] : []);
                  return list.map(s => (
                    <option key={s} value={s}>{s || '—'}</option>
                  ));
                })()}
              </select>
            </div>
            <div className="w-28">
              <label className="block text-xs text-dark-400 mb-1">Вес (г)</label>
              <input
                type="number"
                min="1"
                value={logForm.weight}
                onChange={(e) => setLogForm(f => ({ ...f, weight: e.target.value }))}
                required
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
              />
            </div>
            <div className="w-40">
              <label className="block text-xs text-dark-400 mb-1">Дата</label>
              <input
                type="date"
                value={logForm.date}
                onChange={(e) => setLogForm(f => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={logSaving}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50 text-sm font-medium"
            >
              {logSaving ? '...' : 'Записать'}
            </button>
          </form>
        </div>
      )}

      {/* ─── Empty state ─── */}
      {archives.length === 0 && (
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-8 text-center text-dark-400">
          Нет архивов, ожидающих трима. Трим появится после завершения сбора урожая.
        </div>
      )}

      {/* ─── Карточки ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {archives.map(a => {
          const m = calcMetrics(a);
          return (
            <div key={a._id} className="bg-dark-800 rounded-xl border border-dark-700 p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-white font-semibold">{a.roomName}</h3>
                  <p className="text-dark-400 text-xs">{a.strain} · {a.plantsCount} кустов{m.sqm > 0 ? ` · ${m.sqm} м²` : ''}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  a.trimStatus === 'completed'
                    ? 'bg-green-900/40 text-green-400'
                    : a.trimStatus === 'in_progress'
                      ? 'bg-amber-900/40 text-amber-400'
                      : 'bg-dark-700 text-dark-400'
                }`}>
                  {a.trimStatus === 'completed' ? 'Завершён' : a.trimStatus === 'in_progress' ? 'В процессе' : 'Ожидает'}
                </span>
              </div>

              {/* Metrics */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-dark-400">Сухой вес</span>
                  <span className="text-blue-400 font-medium">{m.dry > 0 ? `${fmt(m.dry, 0)} г` : '—'}</span>
                </div>
                {m.dryPerSqm != null && (
                  <div className="flex justify-between">
                    <span className="text-dark-400">На м²</span>
                    <span className="text-blue-400/70">{fmt(m.dryPerSqm)} г/м²</span>
                  </div>
                )}

                {/* Progress bar: готовность комнаты (%) */}
                <div>
                  <div className="flex justify-between text-xs text-dark-400 mb-1">
                    <span>Готовность комнаты</span>
                    <span>{fmt(m.progressPercent, 0)}%</span>
                  </div>
                  <div className="h-2.5 bg-dark-700 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-l-full transition-all" style={{ width: `${Math.min(100, m.progressPercent)}%` }} />
                  </div>
                </div>

                {/* По сортам + Итого */}
                {(a.strainData && a.strainData.length) ? (
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-dark-500">
                          <th className="text-left py-1 pr-2 font-medium">Сорт</th>
                          <th className="text-right py-1 px-1">Мокрый</th>
                          <th className="text-right py-1 px-1">Сухой</th>
                          {m.sqm > 0 && <th className="text-right py-1 px-1">г/м²</th>}
                          <th className="text-right py-1 px-1">Попкорн</th>
                          <th className="text-right py-1 pl-1">Трим</th>
                        </tr>
                      </thead>
                      <tbody className="text-dark-300">
                        {a.strainData.map((s, i) => (
                          <tr key={i}>
                            <td className="py-0.5 pr-2">{s.strain || '—'}</td>
                            <td className="text-right px-1">{s.wetWeight > 0 ? `${fmt(s.wetWeight, 0)}` : '—'}</td>
                            <td className="text-right px-1 text-blue-400">{s.dryWeight > 0 ? `${fmt(s.dryWeight, 0)}` : '—'}</td>
                            {m.sqm > 0 && <td className="text-right px-1 text-blue-400/80">{s.dryWeight > 0 ? fmt(s.dryWeight / m.sqm) : '—'}</td>}
                            <td className="text-right px-1 text-amber-400">{s.popcornWeight > 0 ? `${fmt(s.popcornWeight, 0)}` : '—'}</td>
                            <td className="text-right pl-1 text-green-400">{(a.trimByStrain && a.trimByStrain[s.strain]) ? fmt(a.trimByStrain[s.strain], 0) : '—'}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-dark-600 text-white font-medium">
                          <td className="py-1 pr-2">Итого</td>
                          <td className="text-right px-1">{fmt(a.strainData.reduce((sum, s) => sum + (s.wetWeight || 0), 0), 0)}</td>
                          <td className="text-right px-1">{fmt(m.dry, 0)}</td>
                          {m.sqm > 0 && <td className="text-right px-1">{fmt(m.dryPerSqm)}</td>}
                          <td className="text-right px-1">{fmt(m.popcorn, 0)}</td>
                          <td className="text-right pl-1 text-green-400">{fmt(m.trim, 0)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-dark-400">Готовый вес</span>
                      <span className="text-green-400 font-medium">{m.trim > 0 ? `${fmt(m.trim, 0)} г` : '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-dark-400">Попкорн</span>
                      <span className="text-amber-400">{m.popcorn > 0 ? `${fmt(m.popcorn, 0)} г` : '—'}</span>
                    </div>
                  </>
                )}
                {m.lossPercent != null && m.dry > 0 && (
                  <div className="flex justify-between">
                    <span className="text-dark-400">Потеря после трима</span>
                    <span className="text-red-400">{fmt(m.lossPercent)}%</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-4 pt-3 border-t border-dark-700">
                <button
                  type="button"
                  onClick={() => openDetail(a._id)}
                  className="px-3 py-1.5 text-primary-400 hover:bg-dark-700 rounded text-xs font-medium"
                >
                  Подробнее
                </button>
                {canEdit && a.trimStatus !== 'completed' && (
                  <button
                    type="button"
                    onClick={() => handleCompleteTrim(a._id)}
                    className="px-3 py-1.5 bg-green-600/80 text-white rounded text-xs hover:bg-green-500 ml-auto"
                  >
                    Завершить трим
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Detail modal ─── */}
      {selectedArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={closeDetail}>
          <div
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{selectedArchive.roomName}</h3>
                <p className="text-dark-400 text-xs">{selectedArchive.strain} · {selectedArchive.plantsCount} кустов · Сбор: {formatDate(selectedArchive.harvestDate)}</p>
              </div>
              <button type="button" onClick={closeDetail} className="text-dark-400 hover:text-white text-xl">&times;</button>
            </div>

            {/* Editable fields: по сортам + готовность комнаты */}
            {canEdit && (
              <div className="mb-4 p-3 bg-dark-700/50 rounded-lg space-y-3">
                <h4 className="text-xs font-medium text-dark-400 uppercase">Данные по сортам</h4>
                <div className="overflow-x-auto">
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
                              placeholder="Название сорта"
                              className="w-full px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm"
                            />
                          </td>
                          <td className="py-1 px-1">
                            <input
                              type="number"
                              min="0"
                              value={s.wetWeight}
                              onChange={e => setEditStrainData(prev => prev.map((r, j) => j === i ? { ...r, wetWeight: e.target.value } : r))}
                              className="w-full px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm text-right"
                            />
                          </td>
                          <td className="py-1 px-1">
                            <input
                              type="number"
                              min="0"
                              value={s.dryWeight}
                              onChange={e => setEditStrainData(prev => prev.map((r, j) => j === i ? { ...r, dryWeight: e.target.value } : r))}
                              className="w-full px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm text-right"
                            />
                          </td>
                          <td className="py-1 pl-1">
                            <input
                              type="number"
                              min="0"
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
                              title="Удалить сорт"
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
                  className="text-xs text-primary-400 hover:text-primary-300"
                >
                  + Добавить сорт
                </button>
                <div className="pt-2">
                  <label className="block text-xs text-dark-400 mb-1">Готовность комнаты (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={editProgressPercent}
                    onChange={e => setEditProgressPercent(e.target.value)}
                    placeholder="0–100"
                    className="w-full max-w-[120px] px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSaveFields}
                  disabled={editSaving}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50 text-sm"
                >
                  {editSaving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            )}

            {/* Metrics summary: по сортам + итого */}
            {(() => {
              const m = calcMetrics(selectedArchive);
              const sd = selectedArchive.strainData && selectedArchive.strainData.length ? selectedArchive.strainData : [];
              return (
                <div className="mb-4 text-sm">
                  <div className="mb-3">
                    <div className="flex justify-between text-dark-400 text-xs mb-1">
                      <span>Готовность комнаты</span>
                      <span>{fmt(m.progressPercent, 0)}%</span>
                    </div>
                    <div className="h-2.5 bg-dark-700 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-l-full transition-all" style={{ width: `${Math.min(100, m.progressPercent)}%` }} />
                    </div>
                  </div>
                  {sd.length > 0 && (
                    <div className="overflow-x-auto mb-3">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="text-dark-500">
                            <th className="text-left py-1 pr-2 font-medium">Сорт</th>
                            <th className="text-right py-1 px-1">Мокрый</th>
                            <th className="text-right py-1 px-1">Сухой</th>
                            {m.sqm > 0 && <th className="text-right py-1 px-1">г/м²</th>}
                            <th className="text-right py-1 px-1">Попкорн</th>
                            <th className="text-right py-1 pl-1">Трим</th>
                          </tr>
                        </thead>
                        <tbody className="text-dark-300">
                          {sd.map((s, i) => (
                            <tr key={i}>
                              <td className="py-0.5 pr-2">{s.strain || '—'}</td>
                              <td className="text-right px-1">{s.wetWeight > 0 ? fmt(s.wetWeight, 0) : '—'}</td>
                              <td className="text-right px-1 text-blue-400">{s.dryWeight > 0 ? fmt(s.dryWeight, 0) : '—'}</td>
                              {m.sqm > 0 && <td className="text-right px-1">{s.dryWeight > 0 ? fmt(s.dryWeight / m.sqm) : '—'}</td>}
                              <td className="text-right px-1 text-amber-400">{s.popcornWeight > 0 ? fmt(s.popcornWeight, 0) : '—'}</td>
                              <td className="text-right pl-1 text-green-400">{(selectedArchive.trimByStrain && selectedArchive.trimByStrain[s.strain]) ? fmt(selectedArchive.trimByStrain[s.strain], 0) : '—'}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-dark-600 text-white font-medium">
                            <td className="py-1 pr-2">Итого</td>
                            <td className="text-right px-1">{fmt(sd.reduce((sum, s) => sum + (s.wetWeight || 0), 0), 0)}</td>
                            <td className="text-right px-1">{fmt(m.dry, 0)}</td>
                            {m.sqm > 0 && <td className="text-right px-1">{fmt(m.dryPerSqm)}</td>}
                            <td className="text-right px-1">{fmt(m.popcorn, 0)}</td>
                            <td className="text-right pl-1 text-green-400">{fmt(m.trim, 0)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-dark-700/30 rounded-lg p-3">
                      <div className="text-dark-500 text-xs uppercase mb-1">Готовый вес (комната)</div>
                      <div className="text-green-400 text-lg font-semibold">{m.trim > 0 ? `${fmt(m.trim, 0)} г` : '—'}</div>
                    </div>
                    <div className="bg-dark-700/30 rounded-lg p-3">
                      <div className="text-dark-500 text-xs uppercase mb-1">Потеря</div>
                      <div className="text-red-400 text-lg font-semibold">{m.lossPercent != null && m.dry > 0 ? `${fmt(m.lossPercent)}%` : '—'}</div>
                    </div>
                    {m.sqm > 0 && (
                      <>
                        <div className="bg-dark-700/30 rounded-lg p-3">
                          <div className="text-dark-500 text-xs uppercase mb-1">Сухой на м²</div>
                          <div className="text-blue-400 font-semibold">{fmt(m.dryPerSqm)} г/м²</div>
                        </div>
                        <div className="bg-dark-700/30 rounded-lg p-3">
                          <div className="text-dark-500 text-xs uppercase mb-1">Готовый на м²</div>
                          <div className="text-green-400 font-semibold">{m.trim > 0 ? `${fmt(m.trimPerSqm)} г/м²` : '—'}</div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Trim logs table */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-white mb-2">Записи трима</h4>
              {logsLoading ? (
                <div className="text-center text-dark-500 py-4">Загрузка...</div>
              ) : logs.length === 0 ? (
                <div className="text-center text-dark-500 py-4 text-sm">Нет записей</div>
              ) : (
                <div className="bg-dark-900 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-dark-400 text-xs uppercase">
                        <th className="px-3 py-2 text-left">Дата</th>
                        <th className="px-3 py-2 text-left">Сорт</th>
                        <th className="px-3 py-2 text-right">Вес (г)</th>
                        <th className="px-3 py-2 text-left">Кто</th>
                        {canEdit && <th className="px-3 py-2 w-10" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-700">
                      {logs.map(log => (
                        <tr key={log._id} className="hover:bg-dark-800/50">
                          <td className="px-3 py-2 text-dark-300">{formatDate(log.date)}</td>
                          <td className="px-3 py-2 text-dark-300">{log.strain || '—'}</td>
                          <td className="px-3 py-2 text-right text-white font-medium">{log.weight}</td>
                          <td className="px-3 py-2 text-dark-400">{log.createdBy?.name || '—'}</td>
                          {canEdit && (
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => handleDeleteLog(log._id)}
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
                </div>
              )}
            </div>

            {/* Complete button */}
            {canEdit && (
              <div className="flex gap-2 pt-3 border-t border-dark-700">
                <button type="button" onClick={closeDetail} className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg text-sm">Закрыть</button>
                {selectedArchive.trimStatus !== 'completed' && (
                  <button
                    type="button"
                    onClick={() => handleCompleteTrim(selectedArchive._id)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 text-sm ml-auto"
                  >
                    Завершить трим
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Trim;
