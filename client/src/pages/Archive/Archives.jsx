import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { archiveService } from '../../services/archiveService';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU');
};

const Archives = () => {
  const [data, setData] = useState({ archives: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadArchives();
  }, []);

  const loadArchives = async () => {
    try {
      setLoading(true);
      const res = await archiveService.getArchives({ limit: 100 });
      setData(res);
    } catch (err) {
      setError('Ошибка загрузки архива');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Архив циклов</h1>
        <p className="text-dark-400 mt-1">История циклов и выполненных действий по комнатам</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      <div className="grid gap-4">
        {data.archives.length === 0 ? (
          <div className="bg-dark-800 rounded-xl p-8 border border-dark-700 text-center text-dark-400">
            Пока нет архивных циклов. Архивируйте цикл из карточки комнаты после сбора урожая.
          </div>
        ) : (
          data.archives.map((archive) => (
            <Link
              key={archive._id}
              to={`/archive/${archive._id}`}
              className="block bg-dark-800 rounded-xl p-4 border border-dark-700 hover:border-primary-600 transition"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-4 flex-wrap">
                  {archive.cycleName && (
                    <span className="text-primary-400 font-medium">{archive.cycleName}</span>
                  )}
                  <span className="text-white font-medium">{archive.roomName}</span>
                  <span className="text-dark-300">{archive.strain || '—'}</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-dark-400">
                  <span>Сбор: {formatDate(archive.harvestDate)}</span>
                  <span>{archive.plantsCount} кустов</span>
                  {archive.harvestData?.dryWeight > 0 && (
                    <span className="text-green-400">{archive.harvestData.dryWeight} г сух.</span>
                  )}
                  {(archive.completedTasks?.length || 0) > 0 && (
                    <span className="text-primary-400">{archive.completedTasks.length} действий</span>
                  )}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
};

export default Archives;
