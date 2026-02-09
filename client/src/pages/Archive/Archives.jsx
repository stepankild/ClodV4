import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { archiveService } from '../../services/archiveService';
import { roomService } from '../../services/roomService';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatNum = (n) => (n != null && Number.isFinite(n) ? Number(n).toLocaleString('ru-RU') : '—');
const formatG = (n) => (n != null && Number.isFinite(n) && n > 0 ? `${Number(n).toLocaleString('ru-RU')}г` : '—');
const pct = (a, b) => (a > 0 && b > 0 ? ((a / b) * 100).toFixed(1) : null);

const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

const StatCard = ({ title, value, unit, icon, color = 'primary' }) => {
  const colors = {
    primary: 'from-primary-900/50 to-primary-800/30 border-primary-700/50',
    green: 'from-green-900/50 to-green-800/30 border-green-700/50',
    blue: 'from-blue-900/50 to-blue-800/30 border-blue-700/50',
    yellow: 'from-yellow-900/50 to-yellow-800/30 border-yellow-700/50',
    purple: 'from-purple-900/50 to-purple-800/30 border-purple-700/50',
    amber: 'from-amber-900/50 to-amber-800/30 border-amber-700/50',
    teal: 'from-teal-900/50 to-teal-800/30 border-teal-700/50',
    red: 'from-red-900/50 to-red-800/30 border-red-700/50'
  };

  return (
    <div className={`bg-gradient-to-br ${colors[color] || colors.primary} border rounded-xl p-4`}>
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

const QualityBadge = ({ quality }) => {
  const styles = {
    low: 'bg-red-900/50 text-red-400',
    medium: 'bg-yellow-900/50 text-yellow-400',
    high: 'bg-green-900/50 text-green-400',
    premium: 'bg-purple-900/50 text-purple-400'
  };
  const labels = { low: 'Низ', medium: 'Сред', high: 'Выс', premium: 'Прем' };
  return (
    <span className={`px-1.5 py-0.5 text-xs rounded ${styles[quality] || styles.medium}`}>
      {labels[quality] || '—'}
    </span>
  );
};

const TrimStatusBadge = ({ status }) => {
  const styles = {
    pending: 'bg-dark-700 text-dark-400',
    in_progress: 'bg-yellow-900/50 text-yellow-400',
    completed: 'bg-green-900/50 text-green-400'
  };
  const labels = { pending: 'Ожид', in_progress: 'Трим', completed: 'Готов' };
  if (!status || status === 'pending') return null;
  return (
    <span className={`px-1.5 py-0.5 text-xs rounded ${styles[status] || styles.pending}`}>
      {labels[status] || status}
    </span>
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
        } else if (sortBy === 'shrinkage') {
          const wa = a.harvestData?.wetWeight || 0;
          const da = a.harvestData?.dryWeight || 0;
          va = wa > 0 ? da / wa : 0;
          const wb = b.harvestData?.wetWeight || 0;
          const db = b.harvestData?.dryWeight || 0;
          vb = wb > 0 ? db / wb : 0;
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
  const t = stats?.total || {};
  const shrinkagePct = pct(t.totalDryWeight, t.totalWetWeight);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Архив циклов</h1>
          <p className="text-dark-400 text-sm mt-1">История завершённых циклов, статистика по сортам, комнатам и месяцам</p>
        </div>
        <button
          onClick={() => setShowStats(!showStats)}
          className="px-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-dark-300 hover:text-white hover:border-dark-600 transition"
        >
          {showStats ? 'Скрыть аналитику' : 'Показать аналитику'}
        </button>
      </div>

      {/* Stats Cards */}
      {showStats && stats && (
        <div className="mb-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatCard title="Циклов" value={t.totalCycles || 0} icon="🌿" color="primary" />
          <StatCard title="Растений" value={formatNum(t.totalPlants)} icon="🌱" color="green" />
          <StatCard title="Сухой вес" value={formatNum(t.totalDryWeight)} unit="г" icon="⚖️" color="blue" />
          <StatCard title="Сырой вес" value={formatNum(t.totalWetWeight)} unit="г" icon="💧" color="teal" />
          <StatCard title="Ср. г/куст" value={formatNum(Math.round(t.avgGramsPerPlant || 0))} unit="г" icon="📊" color="yellow" />
          <StatCard title="Ср. цикл" value={formatNum(Math.round(t.avgDaysFlowering || 0))} unit="дн" icon="📅" color="purple" />
          {shrinkagePct && <StatCard title="Усушка" value={shrinkagePct} unit="%" icon="🔥" color="red" />}
          {t.avgGramsPerWatt > 0 && <StatCard title="Ср. г/ватт" value={formatNum(Math.round(t.avgGramsPerWatt * 100) / 100)} icon="💡" color="amber" />}
        </div>
      )}

      {/* Top strains */}
      {showStats && stats?.byStrain?.length > 0 && (
        <div className="mb-6 bg-dark-800/50 rounded-xl border border-dark-700 p-4">
          <h3 className="text-white font-semibold mb-3">Топ сортов по урожаю</h3>
          <div className="flex flex-wrap gap-2">
            {stats.byStrain.slice(0, 8).map((s, i) => (
              <div
                key={i}
                onClick={() => setStrain(s._id || '')}
                className={`px-3 py-2 rounded-lg cursor-pointer transition ${strain === s._id ? 'bg-primary-600/30 border border-primary-500' : 'bg-dark-700/50 hover:bg-dark-600/50'}`}
              >
                <div className="text-white font-medium">{s._id || 'Без сорта'}</div>
                <div className="text-dark-400 text-xs">
                  {formatG(s.totalWeight)} · {s.cycles} цикл. · {formatNum(Math.round(s.avgGramsPerPlant || 0))}г/к · {formatNum(Math.round(s.avgDays || 0))}дн
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Room stats + Monthly trend side by side */}
      {showStats && stats && (stats.byRoom?.length > 0 || stats.byMonth?.length > 0) && (
        <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Room stats */}
          {stats.byRoom?.length > 0 && (
            <div className="bg-dark-800/50 rounded-xl border border-dark-700 overflow-hidden">
              <h3 className="text-white font-semibold px-4 py-3 border-b border-dark-700">По комнатам</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-dark-900">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs text-dark-500">Комната</th>
                      <th className="px-3 py-2 text-right text-xs text-dark-500">Циклов</th>
                      <th className="px-3 py-2 text-right text-xs text-dark-500">Общий вес</th>
                      <th className="px-3 py-2 text-right text-xs text-dark-500">Ср. вес</th>
                      <th className="px-3 py-2 text-right text-xs text-dark-500">Ср. дней</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-700">
                    {stats.byRoom.map((r, i) => (
                      <tr key={i} className="hover:bg-dark-700/30">
                        <td className="px-3 py-2 text-white">{r._id != null ? `Комната ${r._id}` : '—'}</td>
                        <td className="px-3 py-2 text-right text-dark-300">{r.cycles}</td>
                        <td className="px-3 py-2 text-right text-green-400 font-medium">{formatG(r.totalWeight)}</td>
                        <td className="px-3 py-2 text-right text-dark-300">{formatG(Math.round(r.avgWeight || 0))}</td>
                        <td className="px-3 py-2 text-right text-dark-400">{Math.round(r.avgDays || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Monthly trend */}
          {stats.byMonth?.length > 0 && (
            <div className="bg-dark-800/50 rounded-xl border border-dark-700 overflow-hidden">
              <h3 className="text-white font-semibold px-4 py-3 border-b border-dark-700">По месяцам</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-dark-900">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs text-dark-500">Месяц</th>
                      <th className="px-3 py-2 text-right text-xs text-dark-500">Циклов</th>
                      <th className="px-3 py-2 text-right text-xs text-dark-500">Общий вес</th>
                      <th className="px-3 py-2 text-right text-xs text-dark-500">Ср. г/куст</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-700">
                    {stats.byMonth.map((m, i) => (
                      <tr key={i} className="hover:bg-dark-700/30">
                        <td className="px-3 py-2 text-white">{MONTH_NAMES[(m._id?.month || 1) - 1]} {m._id?.year}</td>
                        <td className="px-3 py-2 text-right text-dark-300">{m.cycles}</td>
                        <td className="px-3 py-2 text-right text-green-400 font-medium">{formatG(m.totalWeight)}</td>
                        <td className="px-3 py-2 text-right text-primary-400">{formatNum(Math.round(m.avgGramsPerPlant || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
              className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm"
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
              placeholder="Поиск"
              value={strain}
              onChange={(e) => setStrain(e.target.value)}
              className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm w-32"
            />
          </div>

          <div>
            <label className="block text-dark-400 text-xs mb-1">Период</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="all">Всё время</option>
              <option value="year">Год</option>
              <option value="6months">6 мес</option>
              <option value="3months">3 мес</option>
              <option value="month">Месяц</option>
            </select>
          </div>

          <div>
            <label className="block text-dark-400 text-xs mb-1">Сортировка</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="harvestDate">Дата урожая</option>
              <option value="startDate">Дата начала</option>
              <option value="dryWeight">Сухой вес</option>
              <option value="gramsPerPlant">г/куст</option>
              <option value="actualDays">Длительность</option>
              <option value="shrinkage">Усушка %</option>
            </select>
          </div>

          <div>
            <label className="block text-dark-400 text-xs mb-1">Порядок</label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm"
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
              Сбросить
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
            <table className="w-full text-left text-sm">
              <thead className="bg-dark-900">
                <tr>
                  <th className="py-3 px-3 text-dark-400 font-medium">Комната</th>
                  <th className="py-3 px-3 text-dark-400 font-medium">Сорт</th>
                  <th className="py-3 px-3 text-dark-400 font-medium">Период</th>
                  <th className="py-3 px-3 text-dark-400 font-medium text-right">Дн</th>
                  <th className="py-3 px-3 text-dark-400 font-medium text-right">Куст</th>
                  <th className="py-3 px-3 text-dark-400 font-medium text-right">Сырой</th>
                  <th className="py-3 px-3 text-dark-400 font-medium text-right">Сухой</th>
                  <th className="py-3 px-3 text-dark-400 font-medium text-right">Трим</th>
                  <th className="py-3 px-3 text-dark-400 font-medium text-right">г/к</th>
                  <th className="py-3 px-3 text-dark-400 font-medium text-right">Усушка</th>
                  <th className="py-3 px-3 text-dark-400 font-medium">Кач</th>
                  <th className="py-3 px-3 text-dark-400 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {archives.map((a) => {
                  const wet = a.harvestData?.wetWeight || 0;
                  const dry = a.harvestData?.dryWeight || 0;
                  const trim = a.trimLogWeight || a.harvestData?.trimWeight || 0;
                  const shrink = pct(dry, wet);
                  const strainCount = Array.isArray(a.strains) ? a.strains.length : 0;
                  return (
                    <tr key={a._id} className="hover:bg-dark-700/50 transition">
                      <td className="py-2.5 px-3">
                        <div className="text-white font-medium text-sm">{a.roomName || `К${a.roomNumber}`}</div>
                        {a.cycleName && <div className="text-dark-500 text-xs">{a.cycleName}</div>}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-white text-sm">{a.strain || '—'}</div>
                        {strainCount > 1 && (
                          <span className="text-dark-500 text-xs">{strainCount} сорт.</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-dark-400 text-xs">
                        <div>{formatDate(a.startDate)}</div>
                        <div>{formatDate(a.harvestDate)}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right text-dark-300">{a.actualDays || '—'}</td>
                      <td className="py-2.5 px-3 text-right text-dark-300">{a.plantsCount || '—'}</td>
                      <td className="py-2.5 px-3 text-right text-dark-400">{formatG(wet)}</td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="text-green-400 font-medium">{formatG(dry)}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="text-dark-400">{trim > 0 ? formatG(trim) : '—'}</span>
                        {a.trimStatus && a.trimStatus !== 'pending' && (
                          <div className="mt-0.5"><TrimStatusBadge status={a.trimStatus} /></div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="text-primary-400 font-medium">{formatNum(a.metrics?.gramsPerPlant)}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-dark-400 text-xs">
                        {shrink ? `${shrink}%` : '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <QualityBadge quality={a.harvestData?.quality} />
                      </td>
                      <td className="py-2.5 px-3">
                        <Link
                          to={`/archive/${a._id}`}
                          className="text-primary-400 hover:text-primary-300 text-xs font-medium"
                        >
                          Детали →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
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
