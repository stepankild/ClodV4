import { useState, useEffect } from 'react';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Daily log form
  const [logForm, setLogForm] = useState({ archiveId: '', weight: '', date: new Date().toISOString().slice(0, 10) });
  const [logSaving, setLogSaving] = useState(false);

  // Detail modal
  const [selectedArchive, setSelectedArchive] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Edit fields inside detail modal
  const [editDry, setEditDry] = useState('');
  const [editPopcorn, setEditPopcorn] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await trimService.getActiveArchives();
      setArchives(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  // ─── Daily log ───
  const handleLogSubmit = async (e) => {
    e.preventDefault();
    if (!logForm.archiveId || !logForm.weight) return;
    setLogSaving(true);
    try {
      await trimService.addLog(logForm.archiveId, Number(logForm.weight), logForm.date);
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
      await trimService.updateArchive(selectedArchive._id, {
        dryWeight: Number(editDry) || 0,
        popcornWeight: Number(editPopcorn) || 0
      });
      await load();
      // Refresh selected archive data
      const updated = (await trimService.getActiveArchives()).find(a => a._id === selectedArchive._id);
      if (updated) {
        setSelectedArchive(updated);
        setEditDry(String(updated.harvestData?.dryWeight || 0));
        setEditPopcorn(String(updated.harvestData?.popcornWeight || 0));
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
    return {
      dry,
      trim,
      popcorn,
      sqm,
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

      {/* ─── Форма быстрого ввода ─── */}
      {canCreate && archives.length > 0 && (
        <div className="mb-6 bg-dark-800 rounded-xl border border-dark-700 p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Записать трим за день</h2>
          <form onSubmit={handleLogSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs text-dark-400 mb-1">Комната</label>
              <select
                value={logForm.archiveId}
                onChange={(e) => setLogForm(f => ({ ...f, archiveId: e.target.value }))}
                required
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
              >
                <option value="">— Выберите —</option>
                {archives.map(a => (
                  <option key={a._id} value={a._id}>{a.roomName} · {a.strain}</option>
                ))}
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
                  a.trimStatus === 'in_progress' ? 'bg-amber-900/40 text-amber-400' : 'bg-dark-700 text-dark-400'
                }`}>
                  {a.trimStatus === 'in_progress' ? 'В процессе' : 'Ожидает'}
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

                {/* Trim progress bar */}
                {m.dry > 0 && (
                  <div>
                    <div className="flex justify-between text-xs text-dark-400 mb-1">
                      <span>Потримлено</span>
                      <span>{fmt(m.trimPercent, 0)}%</span>
                    </div>
                    <div className="h-2.5 bg-dark-700 rounded-full overflow-hidden">
                      <div className="h-full flex">
                        <div className="bg-green-500 rounded-l-full transition-all" style={{ width: `${Math.min(100, m.trimPercent)}%` }} />
                        {m.popcorn > 0 && (
                          <div className="bg-amber-500 transition-all" style={{ width: `${Math.min(100 - m.trimPercent, (m.popcorn / m.dry) * 100)}%` }} />
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-between">
                  <span className="text-dark-400">Готовый вес</span>
                  <span className="text-green-400 font-medium">{m.trim > 0 ? `${fmt(m.trim, 0)} г` : '—'}</span>
                </div>
                {m.trimPerSqm != null && m.trim > 0 && (
                  <div className="flex justify-between">
                    <span className="text-dark-400">Готовый на м²</span>
                    <span className="text-green-400/70">{fmt(m.trimPerSqm)} г/м²</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-dark-400">Попкорн</span>
                  <span className="text-amber-400">{m.popcorn > 0 ? `${fmt(m.popcorn, 0)} г` : '—'}</span>
                </div>
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
                {canEdit && (
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

            {/* Editable fields */}
            {canEdit && (
              <div className="mb-4 p-3 bg-dark-700/50 rounded-lg space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Сухой вес (г)</label>
                    <input
                      type="number"
                      min="0"
                      value={editDry}
                      onChange={e => setEditDry(e.target.value)}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Попкорн (г)</label>
                    <input
                      type="number"
                      min="0"
                      value={editPopcorn}
                      onChange={e => setEditPopcorn(e.target.value)}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                    />
                  </div>
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

            {/* Metrics summary */}
            {(() => {
              const m = calcMetrics(selectedArchive);
              return (
                <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                  <div className="bg-dark-700/30 rounded-lg p-3">
                    <div className="text-dark-500 text-xs uppercase mb-1">Готовый вес</div>
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
                        <th className="px-3 py-2 text-right">Вес (г)</th>
                        <th className="px-3 py-2 text-left">Кто</th>
                        {canEdit && <th className="px-3 py-2 w-10" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-700">
                      {logs.map(log => (
                        <tr key={log._id} className="hover:bg-dark-800/50">
                          <td className="px-3 py-2 text-dark-300">{formatDate(log.date)}</td>
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
                <button
                  type="button"
                  onClick={() => handleCompleteTrim(selectedArchive._id)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 text-sm ml-auto"
                >
                  Завершить трим
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Trim;
