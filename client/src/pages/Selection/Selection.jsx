import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { selectionService } from '../../services/selectionService';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const DEFAULT_CRITERIA = ['Устойчивость', 'Аромат', 'Урожайность', 'Скорость роста', 'Внешний вид'];

const Selection = () => {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission && hasPermission('selection:create');

  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [selected, setSelected] = useState(null);
  const [addModal, setAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', strain: '', startedAt: new Date().toISOString().slice(0, 10), notes: '' });
  const [detailForm, setDetailForm] = useState(null);
  const [newLogEntry, setNewLogEntry] = useState({ date: new Date().toISOString().slice(0, 10), text: '' });
  const [newRatingCriterion, setNewRatingCriterion] = useState('');

  useEffect(() => {
    load();
  }, [statusFilter]);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await selectionService.getAll(statusFilter ? { status: statusFilter } : {});
      setBatches(Array.isArray(data) ? data : []);
      if (selected) {
        const updated = (Array.isArray(data) ? data : []).find((b) => b._id === selected._id);
        if (updated) setSelected(updated);
        else setSelected(null);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Ошибка загрузки');
      setBatches([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selected) {
      const hasRatings = Array.isArray(selected.ratings) && selected.ratings.length > 0;
      setDetailForm({
        name: selected.name || '',
        strain: selected.strain || '',
        startedAt: selected.startedAt ? new Date(selected.startedAt).toISOString().slice(0, 10) : '',
        firstCloneCutAt: selected.firstCloneCutAt ? new Date(selected.firstCloneCutAt).toISOString().slice(0, 10) : '',
        notes: selected.notes || '',
        traitsDescription: selected.traitsDescription || '',
        ratings: hasRatings
          ? selected.ratings.map((r) => ({ criterion: r.criterion || '', score: r.score ?? 0 }))
          : DEFAULT_CRITERIA.map((c) => ({ criterion: c, score: 0 })),
        developmentLog: Array.isArray(selected.developmentLog) ? [...selected.developmentLog] : [],
        status: selected.status || 'active'
      });
    }
  }, [selected]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!(addForm.name || '').trim()) {
      setError('Укажите название бэтча');
      return;
    }
    setSaving(true);
    try {
      const created = await selectionService.create({
        name: addForm.name.trim(),
        strain: (addForm.strain || '').trim(),
        startedAt: addForm.startedAt || null,
        notes: (addForm.notes || '').trim()
      });
      setAddModal(false);
      setAddForm({ name: '', strain: '', startedAt: new Date().toISOString().slice(0, 10), notes: '' });
      await load();
      setSelected(created);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка создания');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDetail = async () => {
    if (!selected || !detailForm) return;
    setSaving(true);
    try {
      const payload = {
        name: detailForm.name.trim(),
        strain: (detailForm.strain || '').trim(),
        startedAt: detailForm.startedAt || null,
        firstCloneCutAt: detailForm.firstCloneCutAt || null,
        notes: (detailForm.notes || '').trim(),
        traitsDescription: (detailForm.traitsDescription || '').trim(),
        ratings: (detailForm.ratings || []).filter((r) => (r.criterion || '').trim()),
        developmentLog: (detailForm.developmentLog || []).map((e) => ({ date: e.date, text: String(e.text || '') })),
        status: detailForm.status
      };
      const updated = await selectionService.update(selected._id, payload);
      setSelected(updated);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const addLogEntry = () => {
    if (!detailForm || !newLogEntry.text.trim()) return;
    setDetailForm((f) => ({
      ...f,
      developmentLog: [...(f.developmentLog || []), { date: newLogEntry.date, text: newLogEntry.text.trim() }]
    }));
    setNewLogEntry({ date: new Date().toISOString().slice(0, 10), text: '' });
  };

  const removeLogEntry = (index) => {
    setDetailForm((f) => ({
      ...f,
      developmentLog: (f.developmentLog || []).filter((_, i) => i !== index)
    }));
  };

  const setRating = (index, score) => {
    setDetailForm((f) => {
      const ratings = [...(f.ratings || [])];
      if (!ratings[index]) return f;
      ratings[index] = { ...ratings[index], score: Math.min(10, Math.max(0, Number(score) || 0)) };
      return { ...f, ratings };
    });
  };

  const addRatingCriterion = () => {
    const c = (newRatingCriterion || '').trim();
    if (!c) return;
    setDetailForm((f) => ({
      ...f,
      ratings: [...(f.ratings || []), { criterion: c, score: 0 }]
    }));
    setNewRatingCriterion('');
  };

  const removeRating = (index) => {
    setDetailForm((f) => ({
      ...f,
      ratings: (f.ratings || []).filter((_, i) => i !== index)
    }));
  };

  const handleDelete = async () => {
    if (!selected || !confirm('Удалить этот бэтч селекции?')) return;
    setSaving(true);
    try {
      await selectionService.delete(selected._id);
      setSelected(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка удаления');
    } finally {
      setSaving(false);
    }
  };

  const avgRating = (ratings) => {
    if (!Array.isArray(ratings) || ratings.length === 0) return null;
    const sum = ratings.reduce((s, r) => s + (Number(r.score) || 0), 0);
    return (sum / ratings.length).toFixed(1);
  };

  if (loading && batches.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <div className="flex-1 min-w-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Селекция</h1>
          <p className="text-dark-400 mt-1">
            Бэтчи селекции: развитие, первые клоны, описание признаков и оценки по 10-балльной шкале.
          </p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4 flex flex-wrap items-center gap-3">
            <span>{error}</span>
            <button type="button" onClick={() => { setError(''); load(); }} className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm">
              Повторить
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
          >
            <option value="active">Активные</option>
            <option value="archived">В архиве</option>
          </select>
          {canCreate && (
            <button
              type="button"
              onClick={() => setAddModal(true)}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 font-medium"
            >
              Добавить бэтч селекции
            </button>
          )}
        </div>

        <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-dark-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase">Название</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase">Сорт / линия</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase">Старт</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase">Первые клоны</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase">Оценка</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {batches.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-dark-500">
                      Нет бэтчей. Добавьте первый бэтч селекции.
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => (
                    <tr
                      key={b._id}
                      onClick={() => setSelected(b)}
                      className={`cursor-pointer hover:bg-dark-700/50 ${selected?._id === b._id ? 'bg-primary-900/30' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-white">{b.name || '—'}</td>
                      <td className="px-4 py-3 text-dark-300">{b.strain || '—'}</td>
                      <td className="px-4 py-3 text-dark-300">{formatDate(b.startedAt)}</td>
                      <td className="px-4 py-3 text-dark-300">{formatDate(b.firstCloneCutAt)}</td>
                      <td className="px-4 py-3 text-dark-300">{avgRating(b.ratings) ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs rounded ${b.status === 'archived' ? 'bg-dark-600 text-dark-400' : 'bg-green-900/50 text-green-400'}`}>
                          {b.status === 'archived' ? 'В архиве' : 'Активный'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Панель деталей */}
      {selected && detailForm && (
        <div className="w-full lg:w-[420px] shrink-0 bg-dark-800 rounded-xl border border-dark-700 p-6 space-y-6 max-h-[calc(100vh-8rem)] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">{detailForm.name || 'Бэтч'}</h2>
            <button type="button" onClick={() => setSelected(null)} className="text-dark-400 hover:text-white p-1">×</button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-dark-400 mb-1">Название</label>
              <input
                type="text"
                value={detailForm.name}
                onChange={(e) => setDetailForm((f) => ({ ...f, name: e.target.value }))}
                disabled={!canCreate}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-dark-400 mb-1">Сорт / линия</label>
              <input
                type="text"
                value={detailForm.strain}
                onChange={(e) => setDetailForm((f) => ({ ...f, strain: e.target.value }))}
                disabled={!canCreate}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-dark-400 mb-1">Старт селекции</label>
                <input
                  type="date"
                  value={detailForm.startedAt}
                  onChange={(e) => setDetailForm((f) => ({ ...f, startedAt: e.target.value }))}
                  disabled={!canCreate}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Первые клоны нарезаны</label>
                <input
                  type="date"
                  value={detailForm.firstCloneCutAt}
                  onChange={(e) => setDetailForm((f) => ({ ...f, firstCloneCutAt: e.target.value }))}
                  disabled={!canCreate}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-dark-400 mb-1">Заметки</label>
              <textarea
                value={detailForm.notes}
                onChange={(e) => setDetailForm((f) => ({ ...f, notes: e.target.value }))}
                disabled={!canCreate}
                rows={2}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none"
              />
            </div>

            <div>
              <label className="block text-xs text-dark-400 mb-1">Описание признаков</label>
              <textarea
                value={detailForm.traitsDescription}
                onChange={(e) => setDetailForm((f) => ({ ...f, traitsDescription: e.target.value }))}
                disabled={!canCreate}
                rows={3}
                placeholder="Внешний вид, запах, устойчивость..."
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none"
              />
            </div>

            <div>
              <label className="block text-xs text-dark-400 mb-2">Лог развития</label>
              <div className="space-y-2 mb-2">
                {(detailForm.developmentLog || []).map((e, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-2 bg-dark-700 rounded-lg">
                    <span className="text-dark-500 text-xs shrink-0">{formatDate(e.date)}</span>
                    <span className="text-dark-300 text-sm flex-1">{e.text || '—'}</span>
                    {canCreate && (
                      <button type="button" onClick={() => removeLogEntry(idx)} className="text-red-400 hover:text-red-300 text-xs">×</button>
                    )}
                  </div>
                ))}
              </div>
              {canCreate && (
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={newLogEntry.date}
                    onChange={(e) => setNewLogEntry((n) => ({ ...n, date: e.target.value }))}
                    className="px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm w-36"
                  />
                  <input
                    type="text"
                    value={newLogEntry.text}
                    onChange={(e) => setNewLogEntry((n) => ({ ...n, text: e.target.value }))}
                    placeholder="Запись о развитии..."
                    className="flex-1 px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm"
                  />
                  <button type="button" onClick={addLogEntry} className="px-3 py-1.5 bg-primary-600 text-white rounded text-sm hover:bg-primary-500">
                    Добавить
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs text-dark-400 mb-2">Оценки (1–10)</label>
              <div className="space-y-2 mb-2">
                {(detailForm.ratings || []).map((r, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-dark-300 text-sm w-28 truncate" title={r.criterion}>{r.criterion || '—'}</span>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="1"
                      value={r.score ?? 0}
                      onChange={(e) => setRating(idx, e.target.value)}
                      disabled={!canCreate}
                      className="flex-1 h-2 bg-dark-700 rounded-lg appearance-none cursor-pointer accent-primary-500"
                    />
                    <span className="text-white text-sm w-6">{r.score ?? 0}</span>
                    {canCreate && (
                      <button type="button" onClick={() => removeRating(idx)} className="text-red-400 hover:text-red-300 text-xs p-1">×</button>
                    )}
                  </div>
                ))}
              </div>
              {canCreate && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newRatingCriterion}
                    onChange={(e) => setNewRatingCriterion(e.target.value)}
                    placeholder="Новый критерий"
                    className="flex-1 px-2 py-1.5 bg-dark-700 border border-dark-600 rounded text-white text-sm"
                  />
                  <button type="button" onClick={addRatingCriterion} className="px-3 py-1.5 bg-primary-600 text-white rounded text-sm hover:bg-primary-500">
                    Добавить
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs text-dark-400 mb-1">Статус</label>
              <select
                value={detailForm.status}
                onChange={(e) => setDetailForm((f) => ({ ...f, status: e.target.value }))}
                disabled={!canCreate}
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
              >
                <option value="active">Активный</option>
                <option value="archived">В архиве</option>
              </select>
            </div>
          </div>

          {canCreate && (
            <div className="flex flex-wrap gap-2 pt-4 border-t border-dark-700">
              <button type="button" onClick={handleSaveDetail} disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50">
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button type="button" onClick={handleDelete} disabled={saving} className="px-4 py-2 bg-red-900/50 text-red-400 rounded-lg hover:bg-red-900/70">
                Удалить
              </button>
            </div>
          )}
        </div>
      )}

      {/* Модалка: новый бэтч */}
      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setAddModal(false)}>
          <div className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4">Новый бэтч селекции</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs text-dark-400 mb-1">Название *</label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Например: Линия А — тест 2025"
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Сорт / линия</label>
                <input
                  type="text"
                  value={addForm.strain}
                  onChange={(e) => setAddForm((f) => ({ ...f, strain: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Дата старта</label>
                <input
                  type="date"
                  value={addForm.startedAt}
                  onChange={(e) => setAddForm((f) => ({ ...f, startedAt: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Заметки</label>
                <textarea
                  value={addForm.notes}
                  onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setAddModal(false)} className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg">Отмена</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50">
                  {saving ? 'Создание...' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Selection;
