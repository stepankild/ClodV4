import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { cloneCutService } from '../../services/cloneCutService';
import { vegBatchService } from '../../services/vegBatchService';
import { archiveService } from '../../services/archiveService';
import api from '../../services/api';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const Trash = () => {
  const { hasPermission } = useAuth();
  const canRestoreClones = hasPermission && hasPermission('clones:create');
  const canRestoreVeg = hasPermission && hasPermission('vegetation:create');
  const canRestoreArchive = hasPermission && (hasPermission('archive:view') || hasPermission('harvest:do'));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState({
    cloneCuts: [],
    vegBatches: [],
    archives: [],
    tasks: []
  });
  const [restoringId, setRestoringId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [cloneCuts, vegBatches, archives, tasks] = await Promise.all([
        canRestoreClones ? cloneCutService.getDeleted().catch(() => []) : [],
        canRestoreVeg ? vegBatchService.getDeleted().catch(() => []) : [],
        canRestoreArchive ? archiveService.getDeleted().catch(() => []) : [],
        api.get('/tasks/deleted').then((r) => r.data).catch(() => [])
      ]);
      setDeleted({
        cloneCuts: Array.isArray(cloneCuts) ? cloneCuts : [],
        vegBatches: Array.isArray(vegBatches) ? vegBatches : [],
        archives: Array.isArray(archives) ? archives : [],
        tasks: Array.isArray(tasks) ? tasks : []
      });
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const restore = async (type, id) => {
    setRestoringId(`${type}-${id}`);
    try {
      if (type === 'cloneCuts') await cloneCutService.restore(id);
      else if (type === 'vegBatches') await vegBatchService.restore(id);
      else if (type === 'archives') await archiveService.restore(id);
      else if (type === 'tasks') await api.post(`/tasks/deleted/${id}/restore`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка восстановления');
    } finally {
      setRestoringId(null);
    }
  };

  const total = deleted.cloneCuts.length + deleted.vegBatches.length + deleted.archives.length + deleted.tasks.length;

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
        <h1 className="text-2xl font-bold text-white">Корзина</h1>
        <p className="text-dark-400 mt-1">
          Удалённые записи можно восстановить в течение времени хранения. Выберите элемент и нажмите «Восстановить».
        </p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => { setError(''); load(); }} className="px-3 py-1.5 bg-red-800/50 rounded text-sm">Повторить</button>
        </div>
      )}

      {total === 0 && (
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-8 text-center text-dark-400">
          Нет удалённых записей для восстановления.
        </div>
      )}

      {deleted.cloneCuts.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">Нарезки клонов</h2>
          <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-dark-900">
                <tr>
                  <th className="px-4 py-2 text-left text-xs text-dark-400">Удалено</th>
                  <th className="px-4 py-2 text-left text-xs text-dark-400">Сорт / дата</th>
                  <th className="px-4 py-2 text-right text-xs text-dark-400">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {deleted.cloneCuts.map((c) => (
                  <tr key={c._id}>
                    <td className="px-4 py-2 text-dark-400">{formatDate(c.deletedAt)}</td>
                    <td className="px-4 py-2 text-dark-300">{c.strain || '—'} · {formatDate(c.cutDate)}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => restore('cloneCuts', c._id)} disabled={!!restoringId} className="px-2 py-1 bg-green-700/50 text-green-400 rounded text-xs hover:bg-green-700/70 disabled:opacity-50">Восстановить</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {deleted.vegBatches.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">Бэтчи вегетации</h2>
          <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-dark-900">
                <tr>
                  <th className="px-4 py-2 text-left text-xs text-dark-400">Удалено</th>
                  <th className="px-4 py-2 text-left text-xs text-dark-400">Название</th>
                  <th className="px-4 py-2 text-right text-xs text-dark-400">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {deleted.vegBatches.map((b) => (
                  <tr key={b._id}>
                    <td className="px-4 py-2 text-dark-400">{formatDate(b.deletedAt)}</td>
                    <td className="px-4 py-2 text-dark-300">{b.name || '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => restore('vegBatches', b._id)} disabled={!!restoringId} className="px-2 py-1 bg-green-700/50 text-green-400 rounded text-xs hover:bg-green-700/70 disabled:opacity-50">Восстановить</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {deleted.archives.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">Архивы циклов</h2>
          <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-dark-900">
                <tr>
                  <th className="px-4 py-2 text-left text-xs text-dark-400">Удалено</th>
                  <th className="px-4 py-2 text-left text-xs text-dark-400">Комната / сорт / урожай</th>
                  <th className="px-4 py-2 text-right text-xs text-dark-400">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {deleted.archives.map((a) => (
                  <tr key={a._id}>
                    <td className="px-4 py-2 text-dark-400">{formatDate(a.deletedAt)}</td>
                    <td className="px-4 py-2 text-dark-300">{a.roomName || '—'} · {a.strain || '—'} · {formatDate(a.harvestDate)}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => restore('archives', a._id)} disabled={!!restoringId} className="px-2 py-1 bg-green-700/50 text-green-400 rounded text-xs hover:bg-green-700/70 disabled:opacity-50">Восстановить</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {deleted.tasks.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-3">Задачи комнат</h2>
          <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-dark-900">
                <tr>
                  <th className="px-4 py-2 text-left text-xs text-dark-400">Удалено</th>
                  <th className="px-4 py-2 text-left text-xs text-dark-400">Задача</th>
                  <th className="px-4 py-2 text-right text-xs text-dark-400">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {deleted.tasks.map((t) => (
                  <tr key={t._id}>
                    <td className="px-4 py-2 text-dark-400">{formatDate(t.deletedAt)}</td>
                    <td className="px-4 py-2 text-dark-300">{t.title || '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => restore('tasks', t._id)} disabled={!!restoringId} className="px-2 py-1 bg-green-700/50 text-green-400 rounded text-xs hover:bg-green-700/70 disabled:opacity-50">Восстановить</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default Trash;
