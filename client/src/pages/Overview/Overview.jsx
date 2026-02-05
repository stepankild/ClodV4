import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { roomService } from '../../services/roomService';
import { cloneCutService } from '../../services/cloneCutService';

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

/** Дней до даты нарезки: положительное = осталось, отрицательное = уже прошло */
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

const Overview = () => {
  const { hasPermission } = useAuth();
  const canEditCycleName = hasPermission ? hasPermission('cycles:edit_name') : false;
  const [rooms, setRooms] = useState([]);
  const safeRooms = (Array.isArray(rooms) ? rooms : []).filter((r) => r != null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [planModal, setPlanModal] = useState(null);
  const [planForm, setPlanForm] = useState({
    cycleName: '',
    strain: '',
    plannedStartDate: '',
    plantsCount: '',
    floweringDays: '56',
    notes: ''
  });
  const [planSaving, setPlanSaving] = useState(false);
  const [cloneCuts, setCloneCuts] = useState([]);

  useEffect(() => {
    loadSummary();
  }, []);

  const loadSummary = async () => {
    try {
      setLoading(true);
      setError('');
      const [data, cuts] = await Promise.all([
        roomService.getRoomsSummary(),
        cloneCutService.getAll().catch(() => [])
      ]);
      setRooms(Array.isArray(data) ? data : []);
      setCloneCuts(Array.isArray(cuts) ? cuts : []);
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      const isNetwork = err.code === 'ECONNREFUSED' || err.message?.includes('Network Error');
      setError(
        isNetwork
          ? 'Не удалось подключиться к серверу. Убедитесь, что бэкенд запущен (порт 5000).'
          : msg || 'Ошибка загрузки обзора'
      );
      console.error('Overview load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCycleNameChange = (roomId, value) => {
    setRooms((prev) => (Array.isArray(prev) ? prev : []).map((r) => (r && r._id === roomId ? { ...r, cycleName: value } : r)));
  };

  const handleCycleNameBlur = async (room) => {
    const value = (room.cycleName || '').trim();
    try {
      await roomService.updateRoom(room._id, { cycleName: value });
    } catch (err) {
      console.error(err);
      loadSummary();
    }
  };

  const openPlanModal = (room, existingPlan) => {
    setPlanModal(room);
    setPlanForm({
      cycleName: existingPlan?.cycleName || '',
      strain: existingPlan?.strain || '',
      plannedStartDate: existingPlan?.plannedStartDate
        ? new Date(existingPlan.plannedStartDate).toISOString().slice(0, 10)
        : '',
      plantsCount: existingPlan?.plantsCount ?? '',
      floweringDays: String(existingPlan?.floweringDays ?? 56),
      notes: existingPlan?.notes || ''
    });
  };

  const closePlanModal = () => {
    setPlanModal(null);
  };

  const handlePlanSubmit = async (e) => {
    e.preventDefault();
    if (!planModal) return;
    setPlanSaving(true);
    try {
      const payload = {
        roomId: planModal._id,
        cycleName: planForm.cycleName.trim(),
        strain: planForm.strain.trim(),
        plannedStartDate: planForm.plannedStartDate || null,
        plantsCount: Number(planForm.plantsCount) || 0,
        floweringDays: Number(planForm.floweringDays) || 56,
        notes: planForm.notes.trim()
      };
      if (planModal.plannedCycle?._id) {
        await roomService.updatePlan(planModal.plannedCycle._id, payload);
      } else {
        await roomService.createPlan(payload);
      }
      closePlanModal();
      await loadSummary();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Ошибка сохранения плана');
    } finally {
      setPlanSaving(false);
    }
  };

  const handlePlanDelete = async () => {
    if (!planModal?.plannedCycle?._id) return;
    if (!confirm('Удалить запланированный цикл?')) return;
    setPlanSaving(true);
    try {
      await roomService.deletePlan(planModal.plannedCycle._id);
      closePlanModal();
      await loadSummary();
    } catch (err) {
      console.error(err);
    } finally {
      setPlanSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Обзор фермы</h1>
        <p className="text-dark-400 mt-1">Состояние всех комнат — заходи и сразу видно, что где происходит</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex flex-wrap items-center gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => { setError(''); loadSummary(); }}
            className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium whitespace-nowrap"
          >
            Повторить
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {safeRooms.map((room) => (
          <div key={room._id} className="flex flex-col gap-2">
            {/* Прошлый цикл — коротко над карточкой */}
            <div className="text-xs text-dark-500 px-1">
              <span className="font-medium text-dark-400">Прошлый цикл:</span>{' '}
              {room.lastArchive ? (
                <Link
                  to={`/archive/${room.lastArchive._id}`}
                  className="text-primary-400 hover:text-primary-300"
                >
                  {room.lastArchive.cycleName || room.lastArchive.strain || 'Цикл'}
                  {room.lastArchive.harvestData?.dryWeight > 0 && ` · ${room.lastArchive.harvestData.dryWeight} г сух.`}
                  {' · '}
                  {formatDate(room.lastArchive.harvestDate)}
                </Link>
              ) : (
                '—'
              )}
            </div>

            {/* Карточка комнаты */}
            <div
              className="bg-dark-800 rounded-xl border border-dark-700 p-5 hover:border-dark-600 transition flex-1"
            >
            <div className="flex items-start justify-between mb-3">
              <Link to="/active" className="text-lg font-semibold text-white hover:text-primary-400 transition">
                {room.name}
              </Link>
              {room.isActive ? (
                <span className="inline-flex items-center gap-1.5 text-primary-400 text-sm shrink-0">
                  <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                  Цветёт
                </span>
              ) : (
                <span className="text-dark-500 text-sm">Свободна</span>
              )}
            </div>

            {/* Название цикла — сразу на карточке, можно редактировать */}
            <div className="mb-3 rounded-lg px-2.5 py-2 bg-dark-700/40 border border-dark-600">
              <label className="block text-xs text-dark-400 mb-1">Название цикла</label>
              {room.isActive ? (
                canEditCycleName ? (
                  <input
                    type="text"
                    value={room.cycleName || ''}
                    onChange={(e) => handleCycleNameChange(room._id, e.target.value)}
                    onBlur={() => handleCycleNameBlur(room)}
                    onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full bg-dark-800/80 text-white text-sm rounded px-2 py-1.5 border border-dark-600 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none placeholder:text-dark-500"
                    placeholder="Введите название цикла"
                  />
                ) : (
                  <div className="text-white text-sm py-1">{room.cycleName || '—'}</div>
                )
              ) : (
                <div className="text-dark-500 text-sm py-1">— Задаётся при старте цикла</div>
              )}
            </div>

            {room.isActive && (
              <>
                <div className="text-dark-300 text-sm mb-3">
                  {room.strain ? <span>{room.strain}</span> : '—'}
                </div>
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-dark-400 mb-1">
                    <span>Прогресс</span>
                    <span className="text-white">
                      {room.currentDay != null && room.floweringDays != null
                        ? `День ${room.currentDay} из ${room.floweringDays}`
                        : ''}{' '}
                      {room.progress != null ? `${room.progress}%` : '0%'}
                    </span>
                  </div>
                  <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full transition-all"
                      style={{ width: `${Math.min(room.progress ?? 0, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-dark-500 mt-1">
                    <span>
                      {room.expectedHarvestDate
                        ? `Урожай: ${formatDate(room.expectedHarvestDate)}`
                        : '—'}
                    </span>
                    {room.daysRemaining != null && room.daysRemaining >= 0 && (
                      <span className="text-dark-400">
                        Осталось {room.daysRemaining} дн.
                      </span>
                    )}
                  </div>
                </div>
                {/* Подрезка нед.2 и Листики нед.4 — в виде прогресс-баров */}
                {(() => {
                  const day = room.currentDay ?? 0;
                  const trimDone = !!room.trimWeek2Done;
                  const defolDone = !!room.defoliationWeek4Done;
                  const trimProgress = trimDone ? 100 : Math.min(100, Math.round((day / 14) * 100));
                  const defolProgress = defolDone ? 100 : Math.min(100, Math.round((day / 28) * 100));
                  const trimDaysLeft = Math.max(0, 14 - day);
                  const defolDaysLeft = Math.max(0, 28 - day);
                  return (
                    <div className="space-y-2 border-t border-dark-700 pt-3">
                      <div>
                        <div className="flex justify-between text-xs text-dark-400 mb-0.5">
                          <span>Подрезка (нед.2)</span>
                          <span className={trimDone ? 'text-green-400' : 'text-dark-400'}>
                            {trimDone ? formatDate(room.trimWeek2Done) : `осталось ${trimDaysLeft} дн.`}
                          </span>
                        </div>
                        <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${trimDone ? 'bg-green-500' : 'bg-primary-500'}`}
                            style={{ width: `${trimProgress}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-dark-400 mb-0.5">
                          <span>Листики (нед.4)</span>
                          <span className={defolDone ? 'text-green-400' : 'text-dark-400'}>
                            {defolDone ? formatDate(room.defoliationWeek4Done) : `осталось ${defolDaysLeft} дн.`}
                          </span>
                        </div>
                        <div className="h-1.5 bg-dark-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${defolDone ? 'bg-green-500' : 'bg-primary-500'}`}
                            style={{ width: `${defolProgress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
            {(room.lastTreatmentAt != null && room.lastTreatmentAt !== '') && (
              <div className="space-y-2 text-sm border-t border-dark-700 pt-3 mt-3">
                <div className="flex justify-between gap-2">
                  <span className="text-dark-500 shrink-0">Последняя обработка</span>
                  <span className="text-dark-300 text-right">
                    {room.lastTreatmentTitle} {formatDate(room.lastTreatmentAt)}
                  </span>
                </div>
              </div>
            )}
            </div>

            {/* Планируется — коротко под карточкой + кнопка планирования */}
            <div className="flex items-center justify-between gap-2 text-xs text-dark-500 px-1">
              <span>
                <span className="font-medium text-dark-400">Планируется:</span>{' '}
                {room.plannedCycle ? (
                  <>
                    {room.plannedCycle.cycleName || room.plannedCycle.strain || 'Цикл'}
                    {room.plannedCycle.plannedStartDate && ` · с ${formatDate(room.plannedCycle.plannedStartDate)}`}
                    {room.plannedCycle.plantsCount > 0 && ` · ${room.plannedCycle.plantsCount} кустов`}
                  </>
                ) : (
                  '—'
                )}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openPlanModal(room, room.plannedCycle); }}
                className="shrink-0 text-primary-400 hover:text-primary-300 font-medium"
              >
                {room.plannedCycle ? 'Изменить план' : 'Планировать'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Модальное окно планирования цикла */}
      {planModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={closePlanModal}>
          <div
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-1">
              Планирование цикла · {planModal.name}
            </h3>
            <p className="text-sm text-dark-400 mb-4">Следующий цикл в этой комнате</p>
            <form onSubmit={handlePlanSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-dark-400 mb-1">Название цикла</label>
                <input
                  type="text"
                  value={planForm.cycleName}
                  onChange={(e) => setPlanForm((f) => ({ ...f, cycleName: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  placeholder="Например: Лето-2025"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Сорт</label>
                <input
                  type="text"
                  value={planForm.strain}
                  onChange={(e) => setPlanForm((f) => ({ ...f, strain: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  placeholder="Название сорта"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Планируемая дата заезда</label>
                <input
                  type="date"
                  value={planForm.plannedStartDate}
                  onChange={(e) => setPlanForm((f) => ({ ...f, plannedStartDate: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-dark-400 mb-1">Кустов</label>
                  <input
                    type="number"
                    min="0"
                    value={planForm.plantsCount}
                    onChange={(e) => setPlanForm((f) => ({ ...f, plantsCount: e.target.value }))}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-dark-400 mb-1">Дней цветения</label>
                  <input
                    type="number"
                    min="1"
                    value={planForm.floweringDays}
                    onChange={(e) => setPlanForm((f) => ({ ...f, floweringDays: e.target.value }))}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Заметки</label>
                <textarea
                  value={planForm.notes}
                  onChange={(e) => setPlanForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none"
                  placeholder="Заметки по плану..."
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={planSaving}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition font-medium disabled:opacity-50"
                >
                  {planSaving ? 'Сохранение...' : 'Сохранить план'}
                </button>
                {planModal.plannedCycle?._id && (
                  <button
                    type="button"
                    onClick={handlePlanDelete}
                    disabled={planSaving}
                    className="px-4 py-2 text-red-400 hover:bg-red-900/30 rounded-lg transition text-sm"
                  >
                    Удалить план
                  </button>
                )}
                <button
                  type="button"
                  onClick={closePlanModal}
                  className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg transition text-sm"
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* План нарезки клонов — все комнаты в столбец, прогресс до нарезки и статус */}
      <div className="mt-8 bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700">
          <h2 className="text-lg font-semibold text-white">План нарезки клонов</h2>
          <Link to="/clones" className="text-primary-400 hover:text-primary-300 text-sm font-medium">
            Подробнее →
          </Link>
        </div>
        <p className="text-dark-400 text-sm px-4 pt-2 pb-1">
          Клоны режутся за {WEEKS_BEFORE_CLONE} недели до даты цветения. Все комнаты ниже.
        </p>
        <div className="flex flex-col">
          {safeRooms.map((room) => {
            const cutDate = getCutDateForRoom(room);
            const daysUntil = cutDate != null ? getDaysUntilCut(cutDate) : null;
            const cut = (Array.isArray(cloneCuts) ? cloneCuts : []).find(
              (c) => c.room?._id === room._id || c.room === room._id
            );
            const isDone = cut?.isDone ?? false;
            const hasPlanOrActive = cutDate != null;

            return (
              <div
                key={room._id}
                className="flex flex-col gap-2 px-4 py-3 border-t border-dark-700 first:border-t-0 hover:bg-dark-700/30"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <Link to="/clones" className="font-medium text-white hover:text-primary-400">
                    {room.name}
                  </Link>
                  {!hasPlanOrActive ? (
                    <span className="text-dark-500 text-sm">Комната не активна · нет плана</span>
                  ) : (
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
                        isDone ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
                      }`}
                    >
                      {isDone ? 'Нарезано' : 'Не нарезано'}
                    </span>
                  )}
                </div>
                {hasPlanOrActive ? (
                  <>
                    <div className="flex justify-between text-xs text-dark-400">
                      <span>До нарезки</span>
                      <span className="text-white">
                        {daysUntil === null
                          ? '—'
                          : daysUntil > 0
                            ? `осталось ${daysUntil} дн.`
                            : daysUntil === 0
                              ? 'сегодня'
                              : `просрочено ${-daysUntil} дн.`}
                      </span>
                    </div>
                    <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full transition-all"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(0, ((DAYS_BEFORE_CUT - (daysUntil ?? 0)) / DAYS_BEFORE_CUT) * 100)
                          )}%`
                        }}
                      />
                    </div>
                    <div className="text-xs text-dark-500">
                      Нарезка: {formatDate(cutDate)}
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex gap-4">
        <Link to="/active" className="text-primary-400 hover:text-primary-300 font-medium">
          Активные комнаты →
        </Link>
        <Link to="/clones" className="text-primary-400 hover:text-primary-300 font-medium">
          Клоны →
        </Link>
        <Link to="/archive" className="text-primary-400 hover:text-primary-300 font-medium">
          Архив циклов →
        </Link>
      </div>
    </div>
  );
};

export default Overview;
