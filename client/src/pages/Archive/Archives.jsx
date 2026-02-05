import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { archiveService } from '../../services/archiveService';
import { roomService } from '../../services/roomService';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatNum = (n) => (n != null && Number.isFinite(n) ? Number(n).toLocaleString('ru-RU') : '—');

const StatCard = ({ title, value, unit, icon, color = 'primary' }) => {
  const colors = {
    primary: 'from-primary-900/50 to-primary-800/30 border-primary-700/50',
    green: 'from-green-900/50 to-green-800/30 border-green-700/50',
    blue: 'from-blue-900/50 to-blue-800/30 border-blue-700/50',
    yellow: 'from-yellow-900/50 to-yellow-800/30 border-yellow-700/50',
    purple: 'from-purple-900/50 to-purple-800/30 border-purple-700/50'
  };

  return (
    <div className={`bg-gradient-to-br ${colors[color]} border rounded-xl p-4`}>
      <div className="flex items-center gap-3">
        <div className="text-2xl">{icon}</div>
        <div>
          <p className="text-dark-400 text-sm">{title}</p>
          <p className="text-white text-xl font-bold">
            {value}{unit && <span className="text-dark-400 text-sm ml-1">{unit}</span>}
          </p>
        </div>
      </div>
    </div>
  );
};

export default function Archives() {
  const [data, setData] = useState({ archives: [], total: 0 });
  const [stats, setStats] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [roomId, setRoomId] = useState('');
  const [strain, setStrain] = useState('');
  const [period, setPeriod] = useState('all');
  const [sortBy, setSortBy] = useState('harvestDate');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showStats, setShowStats] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const params = { limit: 100 };
      if (roomId) params.roomId = roomId;
      if (strain.trim()) params.strain = strain.trim();
      const res = await archiveService.getArchives(params);
      let archives = Array.isArray(res.archives) ? res.archives : [];

      // Client-side period filtering
      if (period !== 'all') {
        const now = new Date();
        let cutoff;
        if (period === 'year') cutoff = new Date(now.getFullYear(), 0, 1);
        else if (period === '6months') { cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 6); }
        else if (period === '3months') { cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 3); }
        else if (period === 'month') { cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 1); }
        archives = archives.filter(a => new Date(a.harvestDate) >= cutoff);
      }

      // Client-side sorting
      archives.sort((a, b) => {
        let va = a[sortBy];
        let vb = b[sortBy];
        if (sortBy === 'harvestDate' || sortBy === 'startDate') {
          va = new Date(va || 0).getTime();
          vb = new Date(vb || 0).getTime();
        } else if (sortBy === 'dryWeight') {
          va = a.harvestData?.dryWeight || 0;
          vb = b.harvestData?.dryWeight || 0;
        } else if (sortBy === 'gramsPerPlant') {
          va = a.metrics?.gramsPerPlant || 0;
          vb = b.metrics?.gramsPerPlant || 0;
        }
        return sortOrder === 'desc' ? vb - va : va - vb;
      });

      setData({ archives, total: archives.length });
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Ошибка загрузки архива');
      setData({ archives: [], total: 0 });
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const res = await archiveService.getStats(period);
      setStats(res);
    } catch (err) {
      console.error('Stats error:', err);
    }
  };

  useEffect(() => {
    load();
  }, [roomId, strain, period, sortBy, sortOrder]);

  useEffect(() => {
    loadStats();
  }, [period]);

  useEffect(() => {
    roomService.getRooms().then((list) => setRooms(Array.isArray(list) ? list : [])).catch(() => setRooms([]));
  }, []);

  const archives = data.archives;

  // Quality badge
  const QualityBadge = ({ quality }) => {
    const styles = {
      low: 'bg-red-900/50 text-red-400',
      medium: 'bg-yellow-900/50 text-yellow-400',
      high: 'bg-green-900/50 text-green-400',
      premium: 'bg-purple-900/50 text-purple-400'
    };
    const labels = { low: 'Низкое', medium: 'Среднее', high: 'Высокое', premium: 'Премиум' };
    return (
      <span className={`px-2 py-0.5 text-xs rounded ${styles[quality] || styles.medium}`}>
        {labels[quality] || quality || 'Среднее'}
      </span>
    );
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Архив циклов</h1>
          <p className="text-dark-400 text-sm mt-1">История завершённых циклов со всей статистикой</p>
        </div>
        <button
          onClick={() => setShowStats(!showStats)}
          className="px-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-dark-300 hover:text-white hover:border-dark-600 transition"
        >
          {showStats ? 'Скрыть статистику' : 'Показать статистику'}
        </button>
      </div>

      {/* Stats */}
      {showStats && stats && (
        <div className="mb-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard
            title="Всего циклов"
            value={stats.total?.totalCycles || 0}
            icon="🌿"
            color="primary"
          />
          <StatCard
            title="Всего растений"
            value={formatNum(stats.total?.totalPlants)}
            icon="🌱"
            color="green"
          />
          <StatCard
            title="Общий сухой вес"
            value={formatNum(stats.total?.totalDryWeight)}
            unit="г"
            icon="⚖️"
            color="blue"
          />
          <StatCard
            title="Средний г/куст"
            value={formatNum(Math.round(stats.total?.avgGramsPerPlant || 0))}
            unit="г"
            icon="📊"
            color="yellow"
          />
          <StatCard
            title="Средний цикл"
            value={formatNum(Math.round(stats.total?.avgDaysFlowering || 0))}
            unit="дней"
            icon="📅"
            color="purple"
          />
        </div>
      )}

      {/* Top strains */}
      {showStats && stats?.byStrain?.length > 0 && (
        <div className="mb-6 bg-dark-800/50 rounded-xl border border-dark-700 p-4">
          <h3 className="text-white font-semibold mb-3">Топ сортов по урожаю</h3>
          <div className="flex flex-wrap gap-2">
            {stats.byStrain.slice(0, 5).map((s, i) => (
              <div
                key={i}
                onClick={() => setStrain(s._id || '')}
                className="px-3 py-2 bg-dark-700/50 rounded-lg cursor-pointer hover:bg-dark-600/50 transition"
              >
                <div className="text-white font-medium">{s._id || 'Без сорта'}</div>
                <div className="text-dark-400 text-xs">
                  {formatNum(s.totalWeight)}г · {s.cycles} цикл{s.cycles > 1 ? 'а' : ''} · {formatNum(Math.round(s.avgGramsPerPlant || 0))}г/куст
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 bg-dark-800/50 rounded-xl border border-dark-700 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-dark-400 text-xs mb-1">Комната</label>
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">Все комнаты</option>
              {rooms.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name || `Комната ${r.roomNumber}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-dark-400 text-xs mb-1">Сорт</label>
            <input
              type="text"
              placeholder="Поиск по сорту"
              value={strain}
              onChange={(e) => setStrain(e.target.value)}
              className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm w-40 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-dark-400 text-xs mb-1">Период</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="all">За всё время</option>
              <option value="year">За год</option>
              <option value="6months">За 6 месяцев</option>
              <option value="3months">За 3 месяца</option>
              <option value="month">За месяц</option>
            </select>
          </div>

          <div>
            <label className="block text-dark-400 text-xs mb-1">Сортировка</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="harvestDate">По дате урожая</option>
              <option value="startDate">По дате начала</option>
              <option value="dryWeight">По сухому весу</option>
              <option value="gramsPerPlant">По г/куст</option>
              <option value="actualDays">По длительности</option>
            </select>
          </div>

          <div>
            <label className="block text-dark-400 text-xs mb-1">Порядок</label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="desc">По убыванию</option>
              <option value="asc">По возрастанию</option>
            </select>
          </div>

          {(roomId || strain || period !== 'all') && (
            <button
              onClick={() => { setRoomId(''); setStrain(''); setPeriod('all'); }}
              className="mt-5 px-3 py-2 text-dark-400 hover:text-white text-sm"
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
        </div>
      ) : archives.length === 0 ? (
        <div className="text-center py-16 bg-dark-800/50 rounded-xl border border-dark-700">
          <div className="text-5xl mb-4">📦</div>
          <p className="text-dark-400 text-lg">Нет завершённых циклов</p>
          <p className="text-dark-500 mt-2">Завершённые циклы появляются здесь после сбора урожая</p>
        </div>
      ) : (
        <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-dark-900">
                <tr>
                  <th className="py-3 px-4 text-dark-400 font-medium text-sm">Комната</th>
                  <th className="py-3 px-4 text-dark-400 font-medium text-sm">Сорт</th>
                  <th className="py-3 px-4 text-dark-400 font-medium text-sm">Цвет</th>
                  <th className="py-3 px-4 text-dark-400 font-medium text-sm">Урожай</th>
                  <th className="py-3 px-4 text-dark-400 font-medium text-sm">Дней</th>
                  <th className="py-3 px-4 text-dark-400 font-medium text-sm">Кустов</th>
                  <th className="py-3 px-4 text-dark-400 font-medium text-sm">Сырой</th>
                  <th className="py-3 px-4 text-dark-400 font-medium text-sm">Сухой</th>
                  <th className="py-3 px-4 text-dark-400 font-medium text-sm">г/куст</th>
                  <th className="py-3 px-4 text-dark-400 font-medium text-sm">Качество</th>
                  <th className="py-3 px-4 text-dark-400 font-medium text-sm w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {archives.map((a) => (
                  <tr key={a._id} className="hover:bg-dark-700/50 transition">
                    <td className="py-3 px-4">
                      <div className="text-white font-medium">{a.roomName || `Комната ${a.roomNumber}`}</div>
                      {a.cycleName && <div className="text-dark-500 text-xs">{a.cycleName}</div>}
                    </td>
                    <td className="py-3 px-4 text-white">{a.strain || '—'}</td>
                    <td className="py-3 px-4 text-dark-300 text-sm">{formatDate(a.startDate)}</td>
                    <td className="py-3 px-4 text-dark-300 text-sm">{formatDate(a.harvestDate)}</td>
                    <td className="py-3 px-4 text-dark-300">{formatNum(a.actualDays)}</td>
                    <td className="py-3 px-4 text-dark-300">{formatNum(a.plantsCount)}</td>
                    <td className="py-3 px-4 text-dark-400 text-sm">{formatNum(a.harvestData?.wetWeight)}г</td>
                    <td className="py-3 px-4">
                      <span className="text-green-400 font-medium">{formatNum(a.harvestData?.dryWeight)}г</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-primary-400 font-medium">{formatNum(a.metrics?.gramsPerPlant)}</span>
                    </td>
                    <td className="py-3 px-4">
                      <QualityBadge quality={a.harvestData?.quality} />
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        to={`/archive/${a._id}`}
                        className="inline-flex items-center gap-1 text-primary-400 hover:text-primary-300 text-sm font-medium"
                      >
                        Детали
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && data.total > 0 && (
        <p className="mt-4 text-dark-400 text-sm">
          Показано: {archives.length} из {data.total} циклов
        </p>
      )}
    </div>
  );
}
