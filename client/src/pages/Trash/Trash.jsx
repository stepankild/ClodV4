import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { cloneCutService } from '../../services/cloneCutService';
import { vegBatchService } from '../../services/vegBatchService';
import { archiveService } from '../../services/archiveService';
import api from '../../services/api';

const TrashSection = ({ title, items, renderInfo, onRestore, restoringId, type, t }) => {
  if (!items || items.length === 0) return null;

  const locale = t('_locale', { defaultValue: 'ru-RU' });

  const formatDate = (date) => {
    if (!date) return '—';
    return new Date(date).toLocaleString(locale === 'en-US' ? 'en-US' : 'ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
        {title}
        <span className="text-dark-500 text-xs font-normal">({items.length})</span>
      </h2>
      <div className="bg-dark-800 rounded-lg border border-dark-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-dark-900">
            <tr>
              <th className="px-4 py-2 text-left text-xs text-dark-400">{t('trash.deletedCol')}</th>
              <th className="px-4 py-2 text-left text-xs text-dark-400">{t('trash.descriptionCol')}</th>
              <th className="px-4 py-2 text-right text-xs text-dark-400">{t('trash.actionCol')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700">
            {items.map((item) => (
              <tr key={item._id} className="hover:bg-dark-700/30">
                <td className="px-4 py-2 text-dark-400 text-xs">{formatDate(item.deletedAt)}</td>
                <td className="px-4 py-2 text-dark-300 text-xs">{renderInfo(item)}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onRestore(type, item._id)}
                    disabled={!!restoringId}
                    className="px-2 py-1 bg-green-700/50 text-green-400 rounded text-xs hover:bg-green-700/70 disabled:opacity-50"
                  >
                    {t('trash.restore')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const Trash = () => {
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();
  const canRestoreClones = hasPermission && hasPermission('clones:delete');
  const canRestoreVeg = hasPermission && hasPermission('vegetation:delete');
  const canRestoreArchive = hasPermission && hasPermission('archive:delete');
  const canRestoreTrim = hasPermission && hasPermission('trim:edit');
  const canRestoreUsers = hasPermission && hasPermission('users:update');

  const locale = i18n.language === 'en' ? 'en-US' : 'ru-RU';

  const formatDate = (date) => {
    if (!date) return '—';
    return new Date(date).toLocaleString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState({
    cloneCuts: [],
    vegBatches: [],
    archives: [],
    tasks: [],
    trimLogs: [],
    plans: [],
    users: [],
    roles: []
  });
  const [restoringId, setRestoringId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [cloneCuts, vegBatches, archives, tasks, trimLogs, plans, users, roles] = await Promise.all([
        canRestoreClones ? cloneCutService.getDeleted().catch(() => []) : [],
        canRestoreVeg ? vegBatchService.getDeleted().catch(() => []) : [],
        canRestoreArchive ? archiveService.getDeleted().catch(() => []) : [],
        api.get('/tasks/deleted').then((r) => r.data).catch(() => []),
        canRestoreTrim ? api.get('/trim/deleted').then((r) => r.data).catch(() => []) : [],
        api.get('/rooms/plans/deleted').then((r) => r.data).catch(() => []),
        canRestoreUsers ? api.get('/users/deleted').then((r) => r.data).catch(() => []) : [],
        canRestoreUsers ? api.get('/users/roles/deleted').then((r) => r.data).catch(() => []) : []
      ]);
      setDeleted({
        cloneCuts: Array.isArray(cloneCuts) ? cloneCuts : [],
        vegBatches: Array.isArray(vegBatches) ? vegBatches : [],
        archives: Array.isArray(archives) ? archives : [],
        tasks: Array.isArray(tasks) ? tasks : [],
        trimLogs: Array.isArray(trimLogs) ? trimLogs : [],
        plans: Array.isArray(plans) ? plans : [],
        users: Array.isArray(users) ? users : [],
        roles: Array.isArray(roles) ? roles : []
      });
    } catch (err) {
      setError(err.response?.data?.message || err.message || t('trash.loadError'));
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
      else if (type === 'trimLogs') await api.post(`/trim/deleted/${id}/restore`);
      else if (type === 'plans') await api.post(`/rooms/plans/deleted/${id}/restore`);
      else if (type === 'users') await api.post(`/users/deleted/${id}/restore`);
      else if (type === 'roles') await api.post(`/users/roles/deleted/${id}/restore`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || t('trash.restoreError'));
    } finally {
      setRestoringId(null);
    }
  };

  const total = Object.values(deleted).reduce((s, arr) => s + arr.length, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1000px] mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">{t('trash.title')}</h1>
        <p className="text-dark-500 text-xs mt-1">
          {total > 0 ? t('trash.deletedCount', { count: total }) : t('trash.emptyTrash')}. {t('trash.canRestore')}
        </p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4 flex items-center justify-between">
          <span className="text-sm">{error}</span>
          <button type="button" onClick={() => { setError(''); load(); }} className="px-3 py-1.5 bg-red-800/50 rounded text-xs">{t('common.retry')}</button>
        </div>
      )}

      {total === 0 && (
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-8 text-center text-dark-400">
          {t('trash.noDeletedRecords')}
        </div>
      )}

      <TrashSection
        title={t('trash.cloneCuts')}
        type="cloneCuts"
        items={deleted.cloneCuts}
        renderInfo={(c) => `${c.strain || '—'} · ${formatDate(c.cutDate)} · ${c.quantity || '?'} ${t('trash.pcs')}`}
        onRestore={restore}
        restoringId={restoringId}
        t={t}
      />

      <TrashSection
        title={t('trash.vegBatches')}
        type="vegBatches"
        items={deleted.vegBatches}
        renderInfo={(b) => b.name || '—'}
        onRestore={restore}
        restoringId={restoringId}
        t={t}
      />

      <TrashSection
        title={t('trash.archives')}
        type="archives"
        items={deleted.archives}
        renderInfo={(a) => `${a.roomName || '—'} · ${a.strain || '—'} · ${formatDate(a.harvestDate)}`}
        onRestore={restore}
        restoringId={restoringId}
        t={t}
      />

      <TrashSection
        title={t('trash.tasks')}
        type="tasks"
        items={deleted.tasks}
        renderInfo={(task) => task.title || '—'}
        onRestore={restore}
        restoringId={restoringId}
        t={t}
      />

      <TrashSection
        title={t('trash.trimLogs')}
        type="trimLogs"
        items={deleted.trimLogs}
        renderInfo={(l) => `${l.strain || '—'} · ${l.weight || 0}${t('common.grams')} · ${formatDate(l.date)}`}
        onRestore={restore}
        restoringId={restoringId}
        t={t}
      />

      <TrashSection
        title={t('trash.plans')}
        type="plans"
        items={deleted.plans}
        renderInfo={(p) => `${p.room?.name || p.room?.roomNumber || '—'} · ${p.strain || '—'} · ${p.cycleName || ''}`}
        onRestore={restore}
        restoringId={restoringId}
        t={t}
      />

      {canRestoreUsers && (
        <>
          <TrashSection
            title={t('trash.users')}
            type="users"
            items={deleted.users}
            renderInfo={(u) => `${u.name || '—'} · ${u.email || '—'}`}
            onRestore={restore}
            restoringId={restoringId}
            t={t}
          />

          <TrashSection
            title={t('trash.roles')}
            type="roles"
            items={deleted.roles}
            renderInfo={(r) => `${r.name || '—'} · ${r.description || ''}`}
            onRestore={restore}
            restoringId={restoringId}
            t={t}
          />
        </>
      )}
    </div>
  );
};

export default Trash;
