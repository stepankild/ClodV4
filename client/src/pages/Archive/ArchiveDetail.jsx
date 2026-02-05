import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { archiveService } from '../../services/archiveService';
import { vegBatchService } from '../../services/vegBatchService';
import { TASK_LABELS } from '../../services/taskService';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
};

const formatDateTime = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const qualityLabels = { low: 'Низкое', medium: 'Среднее', high: 'Высокое', premium: 'Премиум' };

const ArchiveDetail = () => {
  const { id } = useParams();
  const [archive, setArchive] = useState(null);
  const [vegBatches, setVegBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id) {
      archiveService
        .getArchive(id)
        .then((data) => {
          setArchive(data);
          if (data?.room) {
            vegBatchService.getByFlowerRoom(data.room).then(setVegBatches).catch(() => setVegBatches([]));
          }
        })
        .catch(() => setError('Архив не найден'))
        .finally(() => setLoading(false));
    }
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  if (error || !archive) {
    return (
      <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg">
        {error || 'Архив не найден'}
        <Link to="/archive" className="block mt-2 text-primary-400 hover:underline">← К списку архива</Link>
      </div>
    );
  }

  const tasks = archive.completedTasks || [];
  const batches = Array.isArray(vegBatches) ? vegBatches : [];
  const tasksByType = tasks.reduce((acc, t) => {
    const type = t.type || 'custom';
    if (!acc[type]) acc[type] = [];
    acc[type].push(t);
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-6">
        <Link to="/archive" className="text-dark-400 hover:text-white text-sm mb-2 inline-block">← К списку архива</Link>
        <h1 className="text-2xl font-bold text-white">
          {archive.cycleName ? `${archive.cycleName} · ` : ''}Комната {archive.roomNumber} — {archive.roomName}
        </h1>
        <p className="text-dark-400 mt-1">{archive.strain || 'Без сорта'}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-dark-800 rounded-xl p-6 border border-dark-700">
          <h2 className="text-lg font-semibold text-white mb-4">Данные цикла</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-dark-400">Заезд</dt>
              <dd className="text-white">{formatDate(archive.startDate)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-dark-400">Сбор урожая</dt>
              <dd className="text-white">{formatDate(archive.harvestDate)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-dark-400">Кустов</dt>
              <dd className="text-white">{archive.plantsCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-dark-400">Дней цветения</dt>
              <dd className="text-white">{archive.actualDays} / {archive.floweringDays}</dd>
            </div>
          </dl>
        </div>

        <div className="bg-dark-800 rounded-xl p-6 border border-dark-700">
          <h2 className="text-lg font-semibold text-white mb-4">Урожай</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-dark-400">Вес сырой (г)</dt>
              <dd className="text-white">{archive.harvestData?.wetWeight ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-dark-400">Вес сухой (г)</dt>
              <dd className="text-white">{archive.harvestData?.dryWeight ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-dark-400">Трим (г)</dt>
              <dd className="text-white">{archive.harvestData?.trimWeight ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-dark-400">Качество</dt>
              <dd className="text-white">{qualityLabels[archive.harvestData?.quality] ?? archive.harvestData?.quality ?? '—'}</dd>
            </div>
            {archive.metrics?.gramsPerPlant > 0 && (
              <div className="flex justify-between">
                <dt className="text-dark-400">г/куст</dt>
                <dd className="text-white">{archive.metrics.gramsPerPlant}</dd>
              </div>
            )}
          </dl>
          {archive.harvestData?.notes && (
            <p className="mt-3 text-dark-300 text-sm">{archive.harvestData.notes}</p>
          )}
        </div>
      </div>

      {batches.length > 0 && (
        <div className="mt-6 bg-dark-800 rounded-xl p-6 border border-dark-700">
          <h2 className="text-lg font-semibold text-white mb-4">Лог по бэтчам клонов</h2>
          <p className="text-dark-400 text-sm mb-4">
            Клоны нарезаны → пересажены в вегетацию → стояли на веге → отправлены в эту комнату цветения → урожай.
          </p>
          <ul className="space-y-4">
            {batches.map((b) => {
              const vegStart = b.transplantedToVegAt ? new Date(b.transplantedToVegAt) : null;
              const flowerStart = b.transplantedToFlowerAt ? new Date(b.transplantedToFlowerAt) : null;
              const harvestDate = archive.harvestDate ? new Date(archive.harvestDate) : null;
              const daysVeg = vegStart && flowerStart ? Math.max(0, Math.floor((flowerStart - vegStart) / (1000 * 60 * 60 * 24))) : null;
              const daysFlower = flowerStart && harvestDate ? Math.max(0, Math.floor((harvestDate - flowerStart) / (1000 * 60 * 60 * 24))) : (archive.actualDays ?? null);
              return (
                <li key={b._id} className="bg-dark-700/50 rounded-lg p-4 text-sm">
                  <div className="font-medium text-white mb-2">{b.strain || 'Бэтч'}</div>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-dark-300">
                    <span>Нарезка: {formatDate(b.cutDate)}</span>
                    <span>В вегу: {b.quantity} шт.</span>
                    <span>На вегетации: {daysVeg != null ? `${daysVeg} дн.` : '—'}</span>
                    <span>В цвет (эта комната): {formatDate(b.transplantedToFlowerAt)}</span>
                    <span>На цветении: {daysFlower != null ? `${daysFlower} дн.` : '—'}</span>
                    <span>Урожай: {archive.harvestData?.dryWeight != null ? `${archive.harvestData.dryWeight} г сух.` : '—'}</span>
                  </dl>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-6 bg-dark-800 rounded-xl p-6 border border-dark-700">
        <h2 className="text-lg font-semibold text-white mb-4">Выполненные действия за цикл</h2>
        {tasks.length === 0 ? (
          <p className="text-dark-400">Действия не отмечались</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(tasksByType).map(([type, items]) => (
              <div key={type} className="bg-dark-700/50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-primary-400 mb-2">
                  {TASK_LABELS[type] || type}
                </h3>
                <ul className="space-y-2">
                  {items.map((t, i) => (
                    <li key={t.completedAt?.toString() || i} className="flex items-center justify-between text-sm">
                      <span className="text-white">{formatDateTime(t.completedAt)}</span>
                      <span className="text-dark-300">
                        {t.sprayProduct && `Средство: ${t.sprayProduct}`}
                        {t.feedProduct && `Удобрение: ${t.feedProduct}${t.feedDosage ? ` (${t.feedDosage})` : ''}`}
                        {t.dayOfCycle && ` · День ${t.dayOfCycle}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {archive.notes && (
        <div className="mt-6 bg-dark-800 rounded-xl p-6 border border-dark-700">
          <h2 className="text-lg font-semibold text-white mb-2">Заметки</h2>
          <p className="text-dark-300 text-sm whitespace-pre-wrap">{archive.notes}</p>
        </div>
      )}
    </div>
  );
};

export default ArchiveDetail;
