import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { roomService } from '../../services/roomService';
import { archiveService } from '../../services/archiveService';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatNum = (n) => (n != null && Number.isFinite(n) ? Number(n).toLocaleString('ru-RU') : '—');
const roundTo = (n, d = 1) => (n != null && Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

const DAYS_PER_YEAR = 365;

const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

const ChartTooltipStyle = {
  backgroundColor: '#1e1e2e',
  border: '1px solid #374151',
  borderRadius: '8px',
  color: '#e5e7eb',
  fontSize: '13px'
};

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
  const byStrain = stats?.byStrain || [];
  const byMonth = stats?.byMonth || [];
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
  const avgGpw = roundTo(total.avgGramsPerWatt, 2);
  const avgGpp = roundTo(total.avgGramsPerPlant, 1);
  const avgGpd = roundTo(total.avgGramsPerDay, 1);

  // Данные для графика по месяцам
  const monthlyData = byMonth.map((m) => ({
    name: `${MONTH_NAMES[(m._id.month || 1) - 1]} ${String(m._id.year).slice(-2)}`,
    weight: Math.round(m.totalWeight || 0),
    cycles: m.cycles || 0,
    avgGpp: roundTo(m.avgGramsPerPlant, 1) || 0,
    avgGpw: roundTo(m.avgGramsPerWatt, 2) || 0
  }));

  // Данные для pie chart по сортам
  const strainPieData = byStrain.slice(0, 8).map((s) => ({
    name: s._id || '—',
    value: Math.round(s.totalWeight || 0)
  }));

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
            Циклы по комнатам, урожай, эффективность и планирование
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
          <div className="text-dark-400 text-sm font-medium">Всего циклов</div>
          <div className="text-2xl font-bold text-white mt-1">{formatNum(total.totalCycles)}</div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
          <div className="text-dark-400 text-sm font-medium">Урожай (сухой)</div>
          <div className="text-2xl font-bold text-green-400 mt-1">
            {formatNum(total.totalDryWeight)}<span className="text-sm"> г</span>
          </div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
          <div className="text-dark-400 text-sm font-medium">Сред. г/куст</div>
          <div className="text-2xl font-bold text-blue-400 mt-1">
            {avgGpp != null ? avgGpp : '—'}
          </div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
          <div className="text-dark-400 text-sm font-medium">Сред. г/ватт</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {avgGpw != null && avgGpw > 0 ? avgGpw : '—'}
          </div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
          <div className="text-dark-400 text-sm font-medium">Сред. цикл</div>
          <div className="text-2xl font-bold text-white mt-1">
            {avgCycleDays != null ? `${avgCycleDays} дн.` : '—'}
          </div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
          <div className="text-dark-400 text-sm font-medium">Циклов/год (ферма)</div>
          <div className="text-2xl font-bold text-primary-400 mt-1">
            {cyclesPerYearFarm != null ? `~${Math.round(cyclesPerYearFarm)}` : '—'}
          </div>
          <p className="text-dark-500 text-xs mt-1">
            {safeRooms.length} комн.
          </p>
        </div>
      </div>

      {/* Графики */}
      {monthlyData.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Урожай по месяцам */}
          <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
            <h2 className="text-lg font-semibold text-white mb-4">Урожай по месяцам</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Tooltip contentStyle={ChartTooltipStyle} formatter={(v) => [`${v} г`, 'Сухой вес']} />
                <Bar dataKey="weight" fill="#10b981" radius={[4, 4, 0, 0]} name="Сухой вес (г)" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Эффективность по месяцам */}
          <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
            <h2 className="text-lg font-semibold text-white mb-4">Эффективность по месяцам</h2>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Tooltip contentStyle={ChartTooltipStyle} />
                <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
                <Line yAxisId="left" type="monotone" dataKey="avgGpp" stroke="#6366f1" strokeWidth={2} name="г/куст" dot={{ r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="avgGpw" stroke="#f59e0b" strokeWidth={2} name="г/ватт" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Сорта — таблица + pie chart */}
      {byStrain.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2 bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
            <h2 className="text-lg font-semibold text-white px-4 py-3 border-b border-dark-700">
              По сортам
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-dark-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-dark-400 uppercase">Сорт</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase">Циклов</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase">Урожай (г)</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase">Сред. (г)</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase">г/куст</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase">г/ватт</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase">Сред. дней</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700">
                  {byStrain.map((s, i) => (
                    <tr key={s._id || i} className="hover:bg-dark-700/30">
                      <td className="px-4 py-3 font-medium text-white">
                        <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        {s._id || '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-dark-300">{s.cycles}</td>
                      <td className="px-4 py-3 text-right text-green-400">{formatNum(Math.round(s.totalWeight))}</td>
                      <td className="px-4 py-3 text-right text-dark-300">{formatNum(roundTo(s.avgWeight, 0))}</td>
                      <td className="px-4 py-3 text-right text-blue-400">{formatNum(roundTo(s.avgGramsPerPlant, 1))}</td>
                      <td className="px-4 py-3 text-right text-amber-400">{s.avgGramsPerWatt > 0 ? formatNum(roundTo(s.avgGramsPerWatt, 2)) : '—'}</td>
                      <td className="px-4 py-3 text-right text-dark-300">{s.avgDays != null ? Math.round(s.avgDays) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pie chart по сортам */}
          {strainPieData.length > 0 && (
            <div className="bg-dark-800 rounded-xl border border-dark-700 p-5">
              <h2 className="text-lg font-semibold text-white mb-4">Распределение урожая</h2>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={strainPieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={50}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ stroke: '#6b7280' }}
                  >
                    {strainPieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={ChartTooltipStyle} formatter={(v) => [`${v} г`, 'Сухой вес']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

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
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">Дней</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">Урожай (г)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">Сред. цикл</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-dark-400 uppercase tracking-wider">~ Циклов/год</th>
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
                      <td className="px-4 py-3 text-right text-dark-300">{avgDays != null ? `${avgDays} дн.` : '—'}</td>
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
                  const avgGppVal = total.avgGramsPerPlant != null ? Number(total.avgGramsPerPlant) : null;
                  const estimatedDry = room.plantsCount && avgGppVal ? Math.round(room.plantsCount * avgGppVal) : null;
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
          <li>• Средний г/куст: <span className="text-blue-400">{avgGpp ?? '—'}</span></li>
          <li>• Средний г/ватт: <span className="text-amber-400">{avgGpw && avgGpw > 0 ? avgGpw : '—'}</span></li>
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
