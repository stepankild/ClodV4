import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { roomService } from '../../services/roomService';
import { archiveService } from '../../services/archiveService';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatNum = (n) => (n != null && Number.isFinite(n) ? Number(n).toLocaleString('ru-RU') : '—');

const DAYS_PER_YEAR = 365;

const Statistics = () => {
  const [rooms, setRooms] = useState([]);
  const [stats, setStats] = useState(null);
  const [period, setPeriod] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    load();
  }, [period]);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [roomsData, statsData] = await Promise.all([
        roomService.getRoomsSummary(),
        archiveService.getStats(period)
      ]);
      setRooms(Array.isArray(roomsData) ? roomsData : []);
      setStats(statsData || null);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Ошибка загрузки');
      console.error(err);
      setRooms([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  const safeRooms = (Array.isArray(rooms) ? rooms : []).filter((r) => r != null);
  const total = stats?.total || {};
  const byRoomId = (stats?.byRoomId || []).reduce((acc, r) => {
    acc[String(r._id)] = r;
    return acc;
  }, {});

  const periodLabel = {
    all: 'Всё время',
    year: 'За год',
    '6months': 'За 6 мес.',
    '3months': 'За 3 мес.'
  };

  const avgCycleDays = total.avgDaysFlowering != null ? Math.round(Number(total.avgDaysFlowering)) : null;
  const cyclesPerYearFarm = avgCycleDays && avgCycleDays > 0 ? (DAYS_PER_YEAR / avgCycleDays) * safeRooms.length : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Статистика</h1>
          <p className="text-dark-400 mt-1">
            Циклы по комнатам, урожай, гипотетическое количество циклов в год и планируемый урожай
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-dark-500 text-sm">Период:</span>
          {['all', 'year', '6months', '3months'].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                period === p
                  ? 'bg-primary-600 text-white'
                  : 'bg-dark-700 text-dark-300 hover:bg-dark-600 hover:text-white'
              }`}
            >
              {periodLabel[p]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex flex-wrap items-center gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => { setError(''); load(); }}
            className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium"
          >
            Повторить
          </button>
        </div>
      )}

      {/* Сводка по ферме */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
          <div className="text-dark-400 text-sm font-medium">Всего циклов</div>
          <div className="text-2xl font-bold text-white mt-1">{formatNum(total.totalCycles)}</div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
          <div className="text-dark-400 text-sm font-medium">Урожай (сухой вес)</div>
          <div className="text-2xl font-bold text-green-400 mt-1">
            {formatNum(total.totalDryWeight)} г
          </div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
          <div className="text-dark-400 text-sm font-medium">Средняя длина цикла</div>
          <div className="text-2xl font-bold text-white mt-1">
            {avgCycleDays != null ? `${avgCycleDays} дн.` : '—'}
          </div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
          <div className="text-dark-400 text-sm font-medium">Гипотетически циклов в год (ферма)</div>
          <div className="text-2xl font-bold text-primary-400 mt-1">
            {cyclesPerYearFarm != null ? `~${Math.round(cyclesPerYearFarm)}` : '—'}
          </div>
          <p className="text-dark-500 text-xs mt-1">
            при {safeRooms.length} комн. и среднем цикле {avgCycleDays ?? '?'} дн.
          </p>
        </div>
      </div>

      {/* По комнатам */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden mb-8">
        <h2 className="text-lg font-semibold text-white px-4 py-3 border-b border-dark-700">
          По комнатам
        </h2>
        <p className="text-dark-400 text-sm px-4 pt-2 pb-3">
          Сколько циклов прошло, дней в работе, урожай и сколько ещё циклов гипотетически успеем в год.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-dark-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Комната</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">Циклов</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">Дней в работе</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">Урожай (г сух.)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">Сред. цикл (дн.)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">~ Циклов в год</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase tracking-wider">Сейчас</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {safeRooms.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-dark-500">
                    Нет комнат
                  </td>
                </tr>
              ) : (
                safeRooms.map((room) => {
                  const rStat = byRoomId[String(room._id)];
                  const cycles = rStat?.cycles ?? 0;
                  const totalDays = rStat?.totalDays ?? 0;
                  const totalWeight = rStat?.totalWeight ?? 0;
                  const avgDays = rStat?.avgDays != null ? Math.round(Number(rStat.avgDays)) : null;
                  const cyclesPerYear = avgDays && avgDays > 0 ? DAYS_PER_YEAR / avgDays : null;
                  return (
                    <tr key={room._id} className="hover:bg-dark-700/30">
                      <td className="px-4 py-3 font-medium text-white">{room.name}</td>
                      <td className="px-4 py-3 text-right text-dark-300">{formatNum(cycles)}</td>
                      <td className="px-4 py-3 text-right text-dark-300">{formatNum(totalDays)}</td>
                      <td className="px-4 py-3 text-right text-green-400">{formatNum(totalWeight)}</td>
                      <td className="px-4 py-3 text-right text-dark-300">{avgDays != null ? avgDays : '—'}</td>
                      <td className="px-4 py-3 text-right text-primary-400">
                        {cyclesPerYear != null ? `~${cyclesPerYear.toFixed(1)}` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {room.isActive ? (
                          <span className="inline-flex items-center gap-1.5 text-primary-400 text-xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                            Цветёт · урожай {room.expectedHarvestDate ? formatDate(room.expectedHarvestDate) : '—'}
                          </span>
                        ) : room.plannedCycle?.plannedStartDate ? (
                          <span className="text-dark-400 text-xs">
                            План с {formatDate(room.plannedCycle.plannedStartDate)}
                          </span>
                        ) : (
                          <span className="text-dark-500 text-xs">Свободна</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Планируемый урожай (активные комнаты) */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden mb-8">
        <h2 className="text-lg font-semibold text-white px-4 py-3 border-b border-dark-700">
          Планируемый урожай
        </h2>
        <p className="text-dark-400 text-sm px-4 pt-2 pb-3">
          Активные комнаты: когда ожидается сбор и гипотетический урожай по среднему г/куст (из архива).
        </p>
        <div className="px-4 pb-4">
          {safeRooms.filter((r) => r.isActive).length === 0 ? (
            <div className="py-6 text-center text-dark-500">Нет активных комнат</div>
          ) : (
            <div className="space-y-3">
              {safeRooms
                .filter((r) => r.isActive)
                .map((room) => {
                  const rStat = byRoomId[String(room._id)];
                  const avgGpp = total.avgGramsPerPlant != null ? Number(total.avgGramsPerPlant) : null;
                  const estimatedDry = room.plantsCount && avgGpp ? Math.round(room.plantsCount * avgGpp) : null;
                  return (
                    <div
                      key={room._id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-dark-700 last:border-0"
                    >
                      <div className="font-medium text-white">{room.name}</div>
                      <div className="flex flex-wrap items-center gap-4 text-sm">
                        <span className="text-dark-400">
                          Урожай: <span className="text-white">{formatDate(room.expectedHarvestDate)}</span>
                        </span>
                        {room.plantsCount > 0 && (
                          <span className="text-dark-400">
                            Кустов: <span className="text-white">{room.plantsCount}</span>
                          </span>
                        )}
                        {estimatedDry != null && (
                          <span className="text-green-400">~{formatNum(estimatedDry)} г сух. (оценка)</span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Гипотетическое планирование */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
        <h2 className="text-lg font-semibold text-white mb-1">Гипотетическое планирование</h2>
        <p className="text-dark-400 text-sm mb-4">
          Исходя из среднего цикла и числа комнат: сколько циклов в год можно провести, если загружать комнаты без простоев.
        </p>
        <ul className="space-y-2 text-dark-300 text-sm">
          <li>• Средняя длина цикла по архиву: <span className="text-white">{avgCycleDays != null ? `${avgCycleDays} дн.` : '—'}</span></li>
          <li>• Комнат: <span className="text-white">{safeRooms.length}</span></li>
          <li>• Гипотетически циклов в год на одну комнату: <span className="text-primary-400">{avgCycleDays > 0 ? `~${(DAYS_PER_YEAR / avgCycleDays).toFixed(1)}` : '—'}</span></li>
          <li>• Гипотетически циклов в год по всей ферме: <span className="text-primary-400">{cyclesPerYearFarm != null ? `~${Math.round(cyclesPerYearFarm)}` : '—'}</span></li>
        </ul>
        <div className="mt-4 pt-4 border-t border-dark-700">
          <Link to="/" className="text-primary-400 hover:text-primary-300 font-medium text-sm">
            ← Обзор фермы
          </Link>
          <span className="text-dark-500 mx-2">·</span>
          <Link to="/archive" className="text-primary-400 hover:text-primary-300 font-medium text-sm">
            Архив циклов
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Statistics;
