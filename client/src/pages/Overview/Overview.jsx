import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { roomService } from '../../services/roomService';
import { cloneCutService } from '../../services/cloneCutService';
import { vegBatchService } from '../../services/vegBatchService';


const WEEKS_BEFORE_CLONE = 4;
const DAYS_BEFORE_CUT = WEEKS_BEFORE_CLONE * 7;

const getCutDateForRoom = (room) => {
  if (room.plannedCycle?.plannedStartDate) {
    const d = new Date(room.plannedCycle.plannedStartDate);
    d.setDate(d.getDate() - DAYS_BEFORE_CUT);
    return d;
  }
  if (room.isActive && room.expectedHarvestDate) {
    const d = new Date(room.expectedHarvestDate);
    d.setDate(d.getDate() - DAYS_BEFORE_CUT);
    return d;
  }
  return null;
};

const getDaysUntilCut = (cutDate) => {
  if (!cutDate) return null;
  const cut = new Date(cutDate);
  cut.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((cut - today) / (24 * 60 * 60 * 1000));
};

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const formatNum = (n) => (n != null && Number.isFinite(n) ? Number(n).toLocaleString('ru-RU') : '—');

// ── Urgency helpers ──
const getProgressColor = (progress) => {
  if (progress >= 95) return 'bg-red-500';
  if (progress >= 80) return 'bg-yellow-500';
  return 'bg-primary-500';
};

const getBorderColor = (room) => {
  if (!room.isActive) return 'border-dark-700';
  const p = room.progress ?? 0;
  if (p >= 95) return 'border-red-700/60';
  if (p >= 80) return 'border-yellow-700/40';
  return 'border-primary-700/40';
};

const Overview = () => {
  const [rooms, setRooms] = useState([]);
  const safeRooms = (Array.isArray(rooms) ? rooms : []).filter((r) => r != null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cloneCuts, setCloneCuts] = useState([]);
  const [vegBatches, setVegBatches] = useState([]);
  const [expandedNotes, setExpandedNotes] = useState({});

  const toggleNotes = (roomId) => {
    setExpandedNotes(prev => ({ ...prev, [roomId]: !prev[roomId] }));
  };

  useEffect(() => { loadSummary(); }, []);

  const loadSummary = async () => {
    try {
      setLoading(true);
      setError('');
      const [data, cuts, deletedCuts, vegs, deletedVegs] = await Promise.all([
        roomService.getRoomsSummary(),
        cloneCutService.getAll().catch(() => []),
        cloneCutService.getDeleted().catch(() => []),
        vegBatchService.getAll().catch(() => []),
        vegBatchService.getDeleted().catch(() => [])
      ]);
      setRooms(Array.isArray(data) ? data : []);
      const allCuts = [
        ...(Array.isArray(cuts) ? cuts : []),
        ...(Array.isArray(deletedCuts) ? deletedCuts : [])
      ];
      setCloneCuts(allCuts);
      const allVegs = [
        ...(Array.isArray(vegs) ? vegs : []),
        ...(Array.isArray(deletedVegs) ? deletedVegs : [])
      ];
      setVegBatches(allVegs);
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      const isNetwork = err.code === 'ECONNREFUSED' || err.message?.includes('Network Error');
      setError(isNetwork ? 'Не удалось подключиться к серверу.' : msg || 'Ошибка загрузки');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  // ── Computed data ──
  const safeVegBatches = Array.isArray(vegBatches) ? vegBatches : [];
  const safeCloneCuts = Array.isArray(cloneCuts) ? cloneCuts : [];

  const activeRooms = safeRooms.filter(r => r.isActive);
  const flowerPlants = activeRooms.reduce((s, r) => s + (r.plantsCount || 0), 0);

  // Veg plants: active (not deleted, not transplanted to flower) batches
  const activeVegBatches = safeVegBatches.filter(b => !b.deletedAt && !b.transplantedToFlowerAt);
  const vegPlants = activeVegBatches.reduce((s, b) => {
    const total = b.strains?.length > 0
      ? b.strains.reduce((ss, st) => ss + (st.quantity || 0), 0)
      : (b.quantity || 0);
    return s + total - (b.diedCount || 0) - (b.notGrownCount || 0) - (b.sentToFlowerCount || 0) - (b.disposedCount || 0);
  }, 0);

  // Clone plants: done (not deleted) batches that haven't been transplanted to veg yet
  const activeCloneCuts = safeCloneCuts.filter(c => !c.deletedAt && c.isDone && !safeVegBatches.some(
    v => String(v.sourceCloneCut?._id || v.sourceCloneCut || '') === String(c._id)
  ));
  const clonePlants = activeCloneCuts.reduce((s, c) => {
    return s + (c.strains?.length > 0
      ? c.strains.reduce((ss, st) => ss + (st.quantity || 0), 0)
      : (c.quantity || 0));
  }, 0);

  const totalPlants = flowerPlants + Math.max(0, vegPlants) + clonePlants;
  const nearestHarvest = activeRooms
    .filter(r => r.expectedHarvestDate)
    .sort((a, b) => new Date(a.expectedHarvestDate) - new Date(b.expectedHarvestDate))[0] || null;

  const nearestDays = nearestHarvest?.daysRemaining;

  // Alerts — things requiring attention
  const alerts = [];

  // Найти актуальный клон-бэтч для комнаты: самый свежий по cutDate,
  // чья дата нарезки в пределах ±60 дней от расчётной даты нарезки для текущего цикла
  const findCurrentCut = (room) => {
    const cutDate = getCutDateForRoom(room);
    const roomCuts = safeCloneCuts
      .filter(c => String(c.room?._id || c.room || '') === String(room._id))
      .sort((a, b) => new Date(b.cutDate) - new Date(a.cutDate));
    if (!cutDate || roomCuts.length === 0) return roomCuts[0] || null;
    const target = new Date(cutDate).getTime();
    const margin = 60 * 24 * 60 * 60 * 1000; // ±60 дней
    return roomCuts.find(c => Math.abs(new Date(c.cutDate).getTime() - target) <= margin) || null;
  };

  safeRooms.forEach(room => {
    const cutDate = getCutDateForRoom(room);
    if (!cutDate) return;
    const daysUntil = getDaysUntilCut(cutDate);
    const cut = findCurrentCut(room);
    const isDone = cut?.isDone ?? false;
    const hasTransplanted = cut && safeVegBatches.some(
      b => String(b.sourceCloneCut?._id || b.sourceCloneCut || '') === String(cut._id)
    );
    if (!isDone && !hasTransplanted && daysUntil !== null && daysUntil <= 3) {
      alerts.push({
        type: daysUntil < 0 ? 'danger' : 'warning',
        icon: '✂️',
        text: daysUntil < 0
          ? `${room.name}: нарезка клонов просрочена на ${-daysUntil} дн.`
          : daysUntil === 0
            ? `${room.name}: нарезать клоны сегодня!`
            : `${room.name}: нарезать клоны через ${daysUntil} дн.`,
        link: '/clones'
      });
    }
  });

  // Rooms ready to harvest
  activeRooms.forEach(room => {
    if ((room.progress ?? 0) >= 100) {
      alerts.push({
        type: 'danger',
        icon: '🌿',
        text: `${room.name}: готова к сбору урожая (день ${room.currentDay} из ${room.floweringDays})`,
        link: '/harvest'
      });
    }
  });

  // Rooms missing lamp data
  const roomsMissingLamps = safeRooms.filter(r =>
    !r.lighting?.lampCount || !r.lighting?.lampWattage
  );
  if (roomsMissingLamps.length > 0) {
    const names = roomsMissingLamps.map(r => r.name).join(', ');
    alerts.push({
      type: 'warning',
      icon: '💡',
      text: roomsMissingLamps.length === 1
        ? `${names}: не указаны лампы (кол-во / мощность)`
        : `Не указаны лампы (кол-во / мощность): ${names}`,
      link: '/active'
    });
  }

  // Overdue pending tasks
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  safeRooms.forEach(room => {
    (room.pendingTasks || []).forEach(task => {
      if (task.scheduledDate && new Date(task.scheduledDate) < today) {
        alerts.push({
          type: 'warning',
          icon: '⚠️',
          text: `${room.name}: просрочена задача «${task.title}»`,
          link: '/active'
        });
      }
    });
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Обзор фермы</h1>
        <p className="text-dark-400 mt-1 text-sm">Общая картина. Редактирование — в <Link to="/active" className="text-primary-400 hover:text-primary-300">Активных комнатах</Link></p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex flex-wrap items-center gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => { setError(''); loadSummary(); }} className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium">
            Повторить
          </button>
        </div>
      )}

      {/* ═══ Farm summary stats ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">Активных</div>
          <div className="text-xl font-bold text-primary-400 mt-0.5">{activeRooms.length}<span className="text-dark-500 text-sm font-normal"> / {safeRooms.length}</span></div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">Кустов</div>
          <div className="text-xl font-bold text-green-400 mt-0.5">{totalPlants > 0 ? formatNum(totalPlants) : '—'}</div>
          {totalPlants > 0 && (
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
              {flowerPlants > 0 && <span className="text-xs text-purple-400">🌸 {flowerPlants}</span>}
              {vegPlants > 0 && <span className="text-xs text-emerald-400">🌱 {Math.max(0, vegPlants)}</span>}
              {clonePlants > 0 && <span className="text-xs text-blue-400">✂️ {clonePlants}</span>}
            </div>
          )}
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">Ближайший урожай</div>
          <div className="text-xl font-bold text-white mt-0.5">
            {nearestDays != null ? (
              nearestDays <= 0 ? <span className="text-red-400">Сейчас!</span> : `${nearestDays} дн.`
            ) : '—'}
          </div>
          {nearestHarvest && <p className="text-dark-500 text-xs mt-0.5">{nearestHarvest.name}</p>}
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">Сортов в цвете</div>
          <div className="text-xl font-bold text-purple-400 mt-0.5">
            {[...new Set(activeRooms.map(r => r.strain).filter(Boolean))].length || '—'}
          </div>
        </div>
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4">
          <div className="text-dark-400 text-xs font-medium">Задач ожидает</div>
          <div className="text-xl font-bold text-white mt-0.5">
            {safeRooms.reduce((s, r) => s + (r.pendingTasks?.length || 0), 0) || '—'}
          </div>
        </div>
      </div>

      {/* ═══ Alerts ═══ */}
      {alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {alerts.map((a, i) => (
            <Link
              key={i}
              to={a.link}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition hover:brightness-110 ${
                a.type === 'danger'
                  ? 'bg-red-900/20 border-red-700/50 text-red-300'
                  : 'bg-yellow-900/20 border-yellow-700/50 text-yellow-300'
              }`}
            >
              <span className="text-lg shrink-0">{a.icon}</span>
              <span className="text-sm font-medium">{a.text}</span>
              <svg className="w-4 h-4 ml-auto shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}

      {/* ═══ Room cards ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {safeRooms.map((room) => {
          const cutDate = getCutDateForRoom(room);
          const daysUntilCut = cutDate ? getDaysUntilCut(cutDate) : null;
          const cut = findCurrentCut(room);
          const hasTransplantedRoom = cut && safeVegBatches.some(
            b => String(b.sourceCloneCut?._id || b.sourceCloneCut || '') === String(cut._id)
          );
          const clonesDone = (cut?.isDone ?? false) || !!hasTransplantedRoom;
          const hasCutPlan = cutDate != null;

          return (
            <div key={room._id} className={`bg-dark-800 rounded-xl border ${getBorderColor(room)} overflow-hidden transition hover:border-dark-500`}>
              {/* Card header */}
              <div className="px-4 pt-4 pb-2 flex items-start justify-between">
                <div className="min-w-0">
                  <Link to="/active" className="text-base font-semibold text-white hover:text-primary-400 transition block truncate">
                    {room.name}
                  </Link>
                  {room.isActive ? (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-primary-400 text-sm font-medium truncate">{room.strain || room.cycleName || '—'}</span>
                      {room.plantsCount > 0 && (
                        <span className="text-dark-500 text-xs shrink-0">{room.plantsCount} кустов</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-dark-500 text-xs">Нет активного цикла</span>
                  )}
                </div>
                {room.isActive ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium shrink-0 ml-2">
                    <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                    <span className="text-primary-400">Цветёт</span>
                  </span>
                ) : (
                  <span className="text-dark-600 text-xs shrink-0 ml-2">Свободна</span>
                )}
              </div>

              {/* Room info badges */}
              {(room.squareMeters > 0 || room.lighting?.lampType) && (
                <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                  {room.squareMeters > 0 && (
                    <span className="px-2 py-0.5 bg-dark-700 rounded text-dark-400 text-xs">зел. {room.squareMeters} м²</span>
                  )}
                  {room.lighting?.lampType && (
                    <span className="px-2 py-0.5 bg-dark-700 rounded text-dark-400 text-xs">{room.lighting.lampType}</span>
                  )}
                </div>
              )}

              {/* Active cycle content */}
              {room.isActive && (
                <div className="px-4 pb-3">
                  {/* Progress bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-dark-400">
                        День <span className="text-white font-medium">{room.currentDay ?? 0}</span>
                        <span className="text-dark-600"> / {room.floweringDays ?? '?'}</span>
                      </span>
                      <span className={`font-medium ${(room.progress ?? 0) >= 95 ? 'text-red-400' : (room.progress ?? 0) >= 80 ? 'text-yellow-400' : 'text-primary-400'}`}>
                        {room.progress ?? 0}%
                      </span>
                    </div>
                    <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${getProgressColor(room.progress ?? 0)}`}
                        style={{ width: `${Math.min(room.progress ?? 0, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-dark-500 mt-1">
                      <span>Урожай: {formatDate(room.expectedHarvestDate)}</span>
                      {room.daysRemaining != null && room.daysRemaining >= 0 && (
                        <span className={room.daysRemaining <= 3 ? 'text-red-400 font-medium' : ''}>
                          {room.daysRemaining === 0 ? 'Сегодня!' : `${room.daysRemaining} дн.`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Milestones — compact row */}
                  {(() => {
                    const day = room.currentDay ?? 0;
                    const trimDone = !!room.trimWeek2Done;
                    const defolDone = !!room.defoliationWeek4Done;
                    return (
                      <div className="flex gap-2 mb-3">
                        <div className={`flex-1 rounded-lg px-2.5 py-1.5 text-xs ${trimDone ? 'bg-green-900/30 text-green-400' : day >= 14 ? 'bg-red-900/20 text-red-400' : 'bg-dark-700/50 text-dark-400'}`}>
                          <div className="font-medium">Подрезка</div>
                          <div>{trimDone ? formatDate(room.trimWeek2Done) : day >= 14 ? 'Просрочено' : `через ${14 - day} дн.`}</div>
                        </div>
                        <div className={`flex-1 rounded-lg px-2.5 py-1.5 text-xs ${defolDone ? 'bg-green-900/30 text-green-400' : day >= 28 ? 'bg-red-900/20 text-red-400' : 'bg-dark-700/50 text-dark-400'}`}>
                          <div className="font-medium">Дефолиация</div>
                          <div>{defolDone ? formatDate(room.defoliationWeek4Done) : day >= 28 ? 'Просрочено' : `через ${28 - day} дн.`}</div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Completed tasks — compact chips */}
                  {room.completedTasks && Object.keys(room.completedTasks).length > 0 && (
                    <div className="border-t border-dark-700 pt-2 mb-2">
                      <div className="text-xs text-dark-500 mb-1.5">Выполнено</div>
                      <div className="flex flex-wrap gap-1">
                        {room.completedTasks.net?.length > 0 && (
                          <span className="px-2 py-0.5 bg-green-900/30 text-green-400 rounded text-xs">Сетки</span>
                        )}
                        {room.completedTasks.spray?.map((t, i) => (
                          <span key={`sp-${i}`} className="px-2 py-0.5 bg-blue-900/30 text-blue-400 rounded text-xs truncate max-w-[140px]">
                            {t.sprayProduct || 'Обработка'}
                          </span>
                        ))}
                        {room.completedTasks.feed?.map((t, i) => (
                          <span key={`fd-${i}`} className="px-2 py-0.5 bg-emerald-900/30 text-emerald-400 rounded text-xs truncate max-w-[140px]">
                            {t.feedProduct || 'Подкормка'}
                          </span>
                        ))}
                        {room.completedTasks.trim?.length > 0 && (
                          <span className="px-2 py-0.5 bg-purple-900/30 text-purple-400 rounded text-xs">
                            Подрезка ×{room.completedTasks.trim.length}
                          </span>
                        )}
                        {room.completedTasks.defoliation?.length > 0 && (
                          <span className="px-2 py-0.5 bg-yellow-900/30 text-yellow-400 rounded text-xs">
                            Дефол. ×{room.completedTasks.defoliation.length}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Pending tasks — compact */}
                  {room.pendingTasks?.length > 0 && (
                    <div className="border-t border-dark-700 pt-2 mb-2">
                      <div className="text-xs text-dark-500 mb-1">Запланировано ({room.pendingTasks.length})</div>
                      <div className="space-y-0.5">
                        {room.pendingTasks.slice(0, 3).map(task => {
                          const isOverdue = task.scheduledDate && new Date(task.scheduledDate) < today;
                          return (
                            <div key={task._id} className="flex items-center gap-1.5 text-xs">
                              <span className={isOverdue ? 'text-red-400' : 'text-dark-500'}>○</span>
                              <span className={`truncate ${isOverdue ? 'text-red-400' : 'text-dark-400'}`}>{task.title}</span>
                              {task.scheduledDate && (
                                <span className={`ml-auto shrink-0 ${isOverdue ? 'text-red-500' : 'text-dark-600'}`}>{formatDate(task.scheduledDate)}</span>
                              )}
                            </div>
                          );
                        })}
                        {room.pendingTasks.length > 3 && (
                          <div className="text-xs text-dark-600">+{room.pendingTasks.length - 3} ещё</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Card footer — last archive, planned, notes, clone plan */}
              <div className="px-4 pb-3 space-y-2">
                {/* Clone cut status for this room */}
                {hasCutPlan && (
                  <div className={`flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-1.5 ${
                    clonesDone ? 'bg-green-900/20 text-green-400'
                      : daysUntilCut !== null && daysUntilCut < 0 ? 'bg-red-900/20 text-red-400'
                      : daysUntilCut !== null && daysUntilCut <= 7 ? 'bg-yellow-900/20 text-yellow-400'
                      : 'bg-dark-700/30 text-dark-400'
                  }`}>
                    <span className="font-medium">✂️ Клоны</span>
                    <span>
                      {hasTransplantedRoom ? 'В веге ✓' :
                        clonesDone ? 'Нарезано ✓' :
                        daysUntilCut === null ? '—' :
                        daysUntilCut < 0 ? `Просрочено ${-daysUntilCut} дн.` :
                        daysUntilCut === 0 ? 'Сегодня!' :
                        `через ${daysUntilCut} дн.`}
                    </span>
                  </div>
                )}

                {/* Last archive */}
                {room.lastArchive && (
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-dark-500">Прошлый:</span>
                    <Link to={`/archive/${room.lastArchive._id}`} className="text-primary-400 hover:text-primary-300 truncate text-right">
                      {room.lastArchive.strain || room.lastArchive.cycleName || 'Цикл'}
                      {room.lastArchive.harvestData?.dryWeight > 0 && ` · ${room.lastArchive.harvestData.dryWeight}г`}
                    </Link>
                  </div>
                )}

                {/* Planned cycle */}
                {room.plannedCycle && (
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-dark-500">План:</span>
                    <span className="text-dark-300 truncate text-right">
                      {room.plannedCycle.strain || room.plannedCycle.cycleName || 'Цикл'}
                      {room.plannedCycle.plannedStartDate && ` · ${formatDate(room.plannedCycle.plannedStartDate)}`}
                    </span>
                  </div>
                )}

                {/* Notes toggle */}
                {room.notes && (
                  <div>
                    <button
                      onClick={(e) => { e.preventDefault(); toggleNotes(room._id); }}
                      className="flex items-center gap-1.5 text-xs text-dark-500 hover:text-dark-300 w-full text-left"
                    >
                      <span className={`transition-transform inline-block ${expandedNotes[room._id] ? 'rotate-90' : ''}`} style={{ fontSize: '8px' }}>▶</span>
                      Заметки
                    </button>
                    {expandedNotes[room._id] && (
                      <p className="text-xs text-dark-300 mt-1.5 whitespace-pre-wrap bg-dark-700/30 rounded-lg p-2 max-h-24 overflow-y-auto">
                        {room.notes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ Quick links ═══ */}
      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/active" className="px-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-primary-400 hover:border-primary-700/50 transition text-sm font-medium">
          Активные комнаты →
        </Link>
        <Link to="/clones" className="px-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-primary-400 hover:border-primary-700/50 transition text-sm font-medium">
          Клоны →
        </Link>
        <Link to="/statistics" className="px-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-primary-400 hover:border-primary-700/50 transition text-sm font-medium">
          Статистика →
        </Link>
        <Link to="/archive" className="px-4 py-2 bg-dark-800 border border-dark-700 rounded-lg text-primary-400 hover:border-primary-700/50 transition text-sm font-medium">
          Архив →
        </Link>
      </div>
    </div>
  );
};

export default Overview;
