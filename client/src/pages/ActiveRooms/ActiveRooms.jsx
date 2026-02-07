import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { roomService } from '../../services/roomService';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const formatDateInput = (date) => {
  if (!date) return '';
  return new Date(date).toISOString().slice(0, 10);
};

export default function ActiveRooms() {
  const { hasPermission } = useAuth();
  const canEditCycleName = hasPermission ? hasPermission('cycles:edit_name') : false;
  const canHarvest = hasPermission ? hasPermission('harvest:do') : false;

  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [startMode, setStartMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editForm, setEditForm] = useState({
    cycleName: '',
    strain: '',
    plantsCount: '',
    floweringDays: '',
    notes: '',
    startDate: ''
  });

  const [startForm, setStartForm] = useState({
    cycleName: '',
    strain: '',
    plantsCount: '',
    floweringDays: '56',
    notes: '',
    startDate: ''
  });

  const [planMode, setPlanMode] = useState(null);
  const [planForm, setPlanForm] = useState({
    cycleName: '',
    strain: '',
    plannedStartDate: '',
    plantsCount: '',
    floweringDays: '56',
    notes: ''
  });
  const [planSaving, setPlanSaving] = useState(false);

  // Quick tasks state
  const [roomTasks, setRoomTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [sprayFormOpen, setSprayFormOpen] = useState(false);
  const [sprayProduct, setSprayProduct] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
    loadRooms();
  }, []);

  const loadRooms = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await roomService.getRoomsSummary();
      setRooms(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка загрузки комнат');
    } finally {
      setLoading(false);
    }
  };

  const refreshSelectedRoom = async () => {
    await loadRooms();
    const list = await roomService.getRoomsSummary();
    if (selectedRoom) {
      const updated = list.find(r => r._id === selectedRoom._id);
      if (updated) setSelectedRoom(updated);
    }
  };

  const loadRoomTasks = async (roomId) => {
    setTasksLoading(true);
    try {
      const tasks = await roomService.getRoomTasks(roomId);
      setRoomTasks(Array.isArray(tasks) ? tasks : []);
    } catch (err) {
      console.error('Failed to load tasks:', err);
      setRoomTasks([]);
    } finally {
      setTasksLoading(false);
    }
  };

  const openRoom = (room) => {
    setSelectedRoom(room);
    setEditMode(false);
    setStartMode(false);
    setSprayFormOpen(false);
    setSprayProduct('');
    setNoteInput('');
    if (room.isActive) {
      loadRoomTasks(room._id);
    } else {
      setRoomTasks([]);
    }
  };

  const closeRoom = () => {
    setSelectedRoom(null);
    setEditMode(false);
    setStartMode(false);
    setRoomTasks([]);
  };

  const startEditMode = () => {
    if (!selectedRoom) return;
    setEditForm({
      cycleName: selectedRoom.cycleName || '',
      strain: selectedRoom.strain || '',
      plantsCount: selectedRoom.plantsCount || '',
      floweringDays: selectedRoom.floweringDays || 56,
      notes: selectedRoom.notes || '',
      startDate: formatDateInput(selectedRoom.startDate)
    });
    setEditMode(true);
  };

  const startStartMode = () => {
    const today = new Date().toISOString().slice(0, 10);
    setStartForm({
      cycleName: '',
      strain: '',
      plantsCount: '',
      floweringDays: '56',
      notes: '',
      startDate: today
    });
    setStartMode(true);
  };

  const handleEditSave = async () => {
    if (!selectedRoom) return;
    setSaving(true);
    try {
      await roomService.updateRoom(selectedRoom._id, {
        cycleName: editForm.cycleName.trim(),
        strain: editForm.strain.trim(),
        plantsCount: Number(editForm.plantsCount) || 0,
        floweringDays: Number(editForm.floweringDays) || 56,
        notes: editForm.notes.trim(),
        startDate: editForm.startDate || null
      });
      setEditMode(false);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleStartCycle = async () => {
    if (!selectedRoom) return;
    setSaving(true);
    try {
      await roomService.startCycle(selectedRoom._id, {
        cycleName: startForm.cycleName.trim(),
        strain: startForm.strain.trim(),
        plantsCount: Number(startForm.plantsCount) || 0,
        floweringDays: Number(startForm.floweringDays) || 56,
        notes: startForm.notes.trim(),
        startDate: startForm.startDate || new Date().toISOString()
      });
      setStartMode(false);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка запуска цикла');
    } finally {
      setSaving(false);
    }
  };

  const handleHarvest = async () => {
    if (!selectedRoom || !canHarvest) return;
    if (!confirm(`Завершить цикл в ${selectedRoom.name}? Это сбросит комнату.`)) return;
    setSaving(true);
    try {
      await roomService.harvestRoom(selectedRoom._id);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка завершения цикла');
    } finally {
      setSaving(false);
    }
  };

  const openPlanMode = (room) => {
    const plan = room.plannedCycle;
    setPlanMode(room);
    setPlanForm({
      cycleName: plan?.cycleName || '',
      strain: plan?.strain || '',
      plannedStartDate: plan?.plannedStartDate ? new Date(plan.plannedStartDate).toISOString().slice(0, 10) : '',
      plantsCount: plan?.plantsCount ?? '',
      floweringDays: String(plan?.floweringDays ?? 56),
      notes: plan?.notes || ''
    });
  };

  const closePlanMode = () => {
    setPlanMode(null);
  };

  const handlePlanSubmit = async (e) => {
    e.preventDefault();
    if (!planMode) return;
    setPlanSaving(true);
    try {
      const payload = {
        roomId: planMode._id,
        cycleName: planForm.cycleName.trim(),
        strain: planForm.strain.trim(),
        plannedStartDate: planForm.plannedStartDate || null,
        plantsCount: Number(planForm.plantsCount) || 0,
        floweringDays: Number(planForm.floweringDays) || 56,
        notes: planForm.notes.trim()
      };
      if (planMode.plannedCycle?._id) {
        await roomService.updatePlan(planMode.plannedCycle._id, {
          cycleName: payload.cycleName,
          strain: payload.strain,
          plannedStartDate: payload.plannedStartDate,
          plantsCount: payload.plantsCount,
          floweringDays: payload.floweringDays,
          notes: payload.notes
        });
      } else {
        await roomService.createPlan(payload);
      }
      closePlanMode();
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка сохранения плана');
    } finally {
      setPlanSaving(false);
    }
  };

  const handlePlanDelete = async () => {
    if (!planMode?.plannedCycle?._id) return;
    if (!confirm('Удалить запланированный цикл?')) return;
    setPlanSaving(true);
    try {
      await roomService.deletePlan(planMode.plannedCycle._id);
      closePlanMode();
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка удаления плана');
    } finally {
      setPlanSaving(false);
    }
  };

  // --- Quick task handlers ---

  const handleNetToggle = async () => {
    if (!selectedRoom) return;
    const existingNet = roomTasks.find(t => t.type === 'net' && t.completed);
    try {
      if (existingNet) {
        await roomService.deleteTask(existingNet._id);
      } else {
        await roomService.quickTask(selectedRoom._id, { type: 'net' });
      }
      await loadRoomTasks(selectedRoom._id);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  const handleSprayAdd = async () => {
    if (!selectedRoom || !sprayProduct.trim()) return;
    try {
      await roomService.quickTask(selectedRoom._id, {
        type: 'spray',
        product: sprayProduct.trim()
      });
      setSprayProduct('');
      setSprayFormOpen(false);
      await loadRoomTasks(selectedRoom._id);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  const handleTrimAdd = async () => {
    if (!selectedRoom) return;
    try {
      await roomService.quickTask(selectedRoom._id, { type: 'trim' });
      await loadRoomTasks(selectedRoom._id);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  const handleDefoliationAdd = async () => {
    if (!selectedRoom) return;
    try {
      await roomService.quickTask(selectedRoom._id, { type: 'defoliation' });
      await loadRoomTasks(selectedRoom._id);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  const handleAddNote = async () => {
    if (!selectedRoom || !noteInput.trim()) return;
    setNoteSaving(true);
    try {
      await roomService.addNote(selectedRoom._id, noteInput.trim());
      setNoteInput('');
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка добавления заметки');
    } finally {
      setNoteSaving(false);
    }
  };

  const handleDeleteTask = async (taskId) => {
    try {
      await roomService.deleteTask(taskId);
      await loadRoomTasks(selectedRoom._id);
      await refreshSelectedRoom();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  const getProgressColor = (progress) => {
    if (progress >= 90) return 'bg-red-500';
    if (progress >= 70) return 'bg-yellow-500';
    return 'bg-primary-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  const activeRooms = rooms.filter(r => r.isActive);
  const inactiveRooms = rooms.filter(r => !r.isActive);

  const completedTasks = roomTasks.filter(t => t.completed).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  const hasNet = roomTasks.some(t => t.type === 'net' && t.completed);
  const netTask = roomTasks.find(t => t.type === 'net' && t.completed);

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Активные комнаты</h1>
        <p className="text-dark-400 mt-1">Управление циклами цветения</p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex items-center gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-300 hover:text-white">✕</button>
        </div>
      )}

      {/* Активные комнаты */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-primary-500 animate-pulse" />
          Цветут ({activeRooms.length})
        </h2>
        {activeRooms.length === 0 ? (
          <p className="text-dark-400">Нет активных циклов</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {activeRooms.map(room => (
              <div
                key={room._id}
                onClick={() => openRoom(room)}
                className="bg-dark-800 rounded-xl border border-dark-700 p-5 cursor-pointer hover:border-primary-500/50 transition"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold text-white">{room.name}</h3>
                  <span className="text-xs px-2 py-1 rounded bg-primary-900/50 text-primary-400">
                    День {room.currentDay || 1}
                  </span>
                </div>

                <div className="text-sm text-dark-300 mb-2">
                  {room.cycleName && <div className="font-medium text-white">{room.cycleName}</div>}
                  {room.strain && <div>{room.strain}</div>}
                </div>

                <div className="mb-3">
                  <div className="flex justify-between text-xs text-dark-400 mb-1">
                    <span>Прогресс</span>
                    <span>{room.progress || 0}%</span>
                  </div>
                  <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${getProgressColor(room.progress || 0)}`}
                      style={{ width: `${Math.min(room.progress || 0, 100)}%` }}
                    />
                  </div>
                </div>

                <div className="text-xs text-dark-500 space-y-1">
                  <div className="flex justify-between">
                    <span>Кустов:</span>
                    <span className="text-dark-300">{room.plantsCount || 0}</span>
                  </div>
                  {room.flowerStrains && room.flowerStrains.length > 0 && (
                    <div className="text-dark-400">
                      {room.flowerStrains.map((s, i) => (s.strain || s.quantity) && `${s.strain || '—'}: ${s.quantity}`).filter(Boolean).join(', ')}
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Урожай:</span>
                    <span className="text-dark-300">{formatDate(room.expectedHarvestDate)}</span>
                  </div>
                  {room.daysRemaining != null && room.daysRemaining >= 0 && (
                    <div className="flex justify-between">
                      <span>Осталось:</span>
                      <span className="text-primary-400">{room.daysRemaining} дн.</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Свободные комнаты */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-dark-500" />
          Свободные ({inactiveRooms.length})
        </h2>
        {inactiveRooms.length === 0 ? (
          <p className="text-dark-400">Все комнаты заняты</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {inactiveRooms.map(room => (
              <div
                key={room._id}
                onClick={() => openRoom(room)}
                className="bg-dark-800 rounded-xl border border-dark-700 p-5 cursor-pointer hover:border-dark-500 transition"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold text-white">{room.name}</h3>
                  <span className="text-xs px-2 py-1 rounded bg-dark-700 text-dark-400">
                    Свободна
                  </span>
                </div>
                <p className="text-dark-500 text-sm">Нажмите чтобы начать цикл</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Модальное окно комнаты */}
      {selectedRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={closeRoom}>
          <div
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-semibold text-white">{selectedRoom.name}</h3>
                  <p className="text-dark-400 text-sm">
                    {selectedRoom.isActive ? 'Активный цикл' : 'Комната свободна'}
                  </p>
                </div>
                <button onClick={closeRoom} className="text-dark-400 hover:text-white text-2xl leading-none">
                  ×
                </button>
              </div>

              {/* Режим редактирования */}
              {editMode && selectedRoom.isActive && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Название цикла</label>
                    <input
                      type="text"
                      value={editForm.cycleName}
                      onChange={e => setEditForm(f => ({ ...f, cycleName: e.target.value }))}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      disabled={!canEditCycleName}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Сорт</label>
                    <input
                      type="text"
                      value={editForm.strain}
                      onChange={e => setEditForm(f => ({ ...f, strain: e.target.value }))}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-dark-400 mb-1">Кустов</label>
                      <input
                        type="number"
                        min="0"
                        value={editForm.plantsCount}
                        onChange={e => setEditForm(f => ({ ...f, plantsCount: e.target.value }))}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-dark-400 mb-1">Дней цветения</label>
                      <input
                        type="number"
                        min="1"
                        value={editForm.floweringDays}
                        onChange={e => setEditForm(f => ({ ...f, floweringDays: e.target.value }))}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Дата старта</label>
                    <input
                      type="date"
                      value={editForm.startDate}
                      onChange={e => setEditForm(f => ({ ...f, startDate: e.target.value }))}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Заметки</label>
                    <textarea
                      value={editForm.notes}
                      onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleEditSave}
                      disabled={saving}
                      className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition disabled:opacity-50"
                    >
                      {saving ? 'Сохранение...' : 'Сохранить'}
                    </button>
                    <button
                      onClick={() => setEditMode(false)}
                      className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg transition"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              {/* Режим начала цикла */}
              {startMode && !selectedRoom.isActive && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Название цикла</label>
                    <input
                      type="text"
                      value={startForm.cycleName}
                      onChange={e => setStartForm(f => ({ ...f, cycleName: e.target.value }))}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      placeholder="Например: Зима-2026"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Сорт</label>
                    <input
                      type="text"
                      value={startForm.strain}
                      onChange={e => setStartForm(f => ({ ...f, strain: e.target.value }))}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      placeholder="Название сорта"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-dark-400 mb-1">Кустов</label>
                      <input
                        type="number"
                        min="0"
                        value={startForm.plantsCount}
                        onChange={e => setStartForm(f => ({ ...f, plantsCount: e.target.value }))}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-dark-400 mb-1">Дней цветения</label>
                      <input
                        type="number"
                        min="1"
                        value={startForm.floweringDays}
                        onChange={e => setStartForm(f => ({ ...f, floweringDays: e.target.value }))}
                        className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Дата старта</label>
                    <input
                      type="date"
                      value={startForm.startDate}
                      onChange={e => setStartForm(f => ({ ...f, startDate: e.target.value }))}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-400 mb-1">Заметки</label>
                    <textarea
                      value={startForm.notes}
                      onChange={e => setStartForm(f => ({ ...f, notes: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none"
                      placeholder="Заметки по циклу..."
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleStartCycle}
                      disabled={saving}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition disabled:opacity-50"
                    >
                      {saving ? 'Запуск...' : 'Начать цикл'}
                    </button>
                    <button
                      onClick={() => setStartMode(false)}
                      className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg transition"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              {/* Просмотр информации */}
              {!editMode && !startMode && (
                <>
                  {selectedRoom.isActive ? (
                    <div className="space-y-4">
                      {/* Основная информация */}
                      <div className="bg-dark-700/50 rounded-lg p-4 space-y-3">
                        {selectedRoom.cycleName && (
                          <div className="flex justify-between">
                            <span className="text-dark-400">Цикл:</span>
                            <span className="text-white font-medium">{selectedRoom.cycleName}</span>
                          </div>
                        )}
                        {selectedRoom.strain && (
                          <div className="flex justify-between">
                            <span className="text-dark-400">Сорт:</span>
                            <span className="text-white">{selectedRoom.strain}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-dark-400">Кустов:</span>
                          <span className="text-white">{selectedRoom.plantsCount || 0}</span>
                        </div>
                        {selectedRoom.flowerStrains && selectedRoom.flowerStrains.length > 0 && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                            <span className="text-dark-400">По сортам:</span>
                            <span className="text-white">{selectedRoom.flowerStrains.map((s) => `${s.strain || '—'}: ${s.quantity}`).join(', ')}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-dark-400">День цветения:</span>
                          <span className="text-white">{selectedRoom.currentDay || 1} из {selectedRoom.floweringDays || 56}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-dark-400">Старт:</span>
                          <span className="text-white">{formatDate(selectedRoom.startDate)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-dark-400">Ожидаемый урожай:</span>
                          <span className="text-primary-400">{formatDate(selectedRoom.expectedHarvestDate)}</span>
                        </div>
                      </div>

                      {/* Прогресс */}
                      <div>
                        <div className="flex justify-between text-sm text-dark-400 mb-2">
                          <span>Прогресс цветения</span>
                          <span className="text-white">{selectedRoom.progress || 0}%</span>
                        </div>
                        <div className="h-3 bg-dark-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${getProgressColor(selectedRoom.progress || 0)}`}
                            style={{ width: `${Math.min(selectedRoom.progress || 0, 100)}%` }}
                          />
                        </div>
                        {selectedRoom.daysRemaining != null && selectedRoom.daysRemaining >= 0 && (
                          <p className="text-sm text-dark-500 mt-2">
                            Осталось {selectedRoom.daysRemaining} дней
                          </p>
                        )}
                      </div>

                      {/* Быстрые действия */}
                      <div className="space-y-3 border-t border-dark-700 pt-4">
                        <h4 className="text-sm font-medium text-dark-300">Быстрые действия</h4>

                        {/* Сетки */}
                        <label className="flex items-center gap-3 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={hasNet}
                            onChange={handleNetToggle}
                            className="w-4 h-4 rounded border-dark-500 bg-dark-700 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="text-sm text-dark-300 group-hover:text-white">Сетки натянуты</span>
                          {netTask && (
                            <span className="text-xs text-dark-500 ml-auto">{formatDate(netTask.completedAt)}</span>
                          )}
                        </label>

                        {/* Обработка */}
                        <div>
                          <button
                            onClick={() => setSprayFormOpen(!sprayFormOpen)}
                            className="text-sm text-primary-400 hover:text-primary-300"
                          >
                            + Добавить обработку
                          </button>
                          {sprayFormOpen && (
                            <div className="flex gap-2 mt-2">
                              <input
                                type="text"
                                value={sprayProduct}
                                onChange={e => setSprayProduct(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSprayAdd()}
                                placeholder="Название препарата"
                                className="flex-1 px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                                autoFocus
                              />
                              <button
                                onClick={handleSprayAdd}
                                disabled={!sprayProduct.trim()}
                                className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 disabled:opacity-50"
                              >
                                OK
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Подрезка */}
                        <button
                          onClick={handleTrimAdd}
                          className="text-sm text-primary-400 hover:text-primary-300 block"
                        >
                          + Записать подрезку
                        </button>

                        {/* Дефолиация */}
                        <button
                          onClick={handleDefoliationAdd}
                          className="text-sm text-primary-400 hover:text-primary-300 block"
                        >
                          + Записать дефолиацию
                        </button>
                      </div>

                      {/* Заметки */}
                      <div className="space-y-2 border-t border-dark-700 pt-4">
                        <h4 className="text-sm font-medium text-dark-300">Заметки</h4>
                        {selectedRoom.notes && (
                          <p className="text-sm text-dark-300 whitespace-pre-wrap bg-dark-700/30 rounded-lg p-3 max-h-32 overflow-y-auto">
                            {selectedRoom.notes}
                          </p>
                        )}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={noteInput}
                            onChange={e => setNoteInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                            placeholder="Добавить заметку..."
                            className="flex-1 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                          />
                          <button
                            onClick={handleAddNote}
                            disabled={noteSaving || !noteInput.trim()}
                            className="px-3 py-2 bg-dark-700 text-white rounded-lg text-sm hover:bg-dark-600 disabled:opacity-50"
                          >
                            {noteSaving ? '...' : '+'}
                          </button>
                        </div>
                      </div>

                      {/* История работ */}
                      {tasksLoading ? (
                        <div className="text-dark-500 text-sm border-t border-dark-700 pt-4">Загрузка задач...</div>
                      ) : completedTasks.length > 0 && (
                        <div className="space-y-2 border-t border-dark-700 pt-4">
                          <h4 className="text-sm font-medium text-dark-300">История работ</h4>
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {completedTasks.map(task => (
                              <div key={task._id} className="flex items-center justify-between text-xs py-1 group">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-green-400 shrink-0">&#10003;</span>
                                  <span className="text-dark-300 truncate">{task.title}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                  <span className="text-dark-500">{formatDate(task.completedAt)}</span>
                                  <button
                                    onClick={() => handleDeleteTask(task._id)}
                                    className="text-dark-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
                                    title="Отменить"
                                  >
                                    &#10005;
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Кнопки действий */}
                      <div className="flex flex-wrap gap-2 pt-4 border-t border-dark-700">
                        <button
                          onClick={startEditMode}
                          className="px-4 py-2 bg-dark-700 text-white rounded-lg hover:bg-dark-600 transition"
                        >
                          Редактировать
                        </button>
                        {canHarvest && (
                          <button
                            onClick={handleHarvest}
                            disabled={saving}
                            className="px-4 py-2 bg-red-600/80 text-white rounded-lg hover:bg-red-600 transition disabled:opacity-50"
                          >
                            {saving ? '...' : 'Завершить цикл'}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {selectedRoom.plannedCycle ? (
                        <div className="bg-dark-700/50 rounded-lg p-4 text-left">
                          <div className="text-xs text-dark-400 mb-2">Планируется</div>
                          <div className="text-white font-medium">{selectedRoom.plannedCycle.cycleName || selectedRoom.plannedCycle.strain || 'Цикл'}</div>
                          {selectedRoom.plannedCycle.strain && selectedRoom.plannedCycle.cycleName && (
                            <div className="text-dark-300 text-sm">{selectedRoom.plannedCycle.strain}</div>
                          )}
                          <div className="text-dark-400 text-sm mt-2">
                            {selectedRoom.plannedCycle.plannedStartDate && `Старт: ${formatDate(selectedRoom.plannedCycle.plannedStartDate)} · `}
                            {selectedRoom.plannedCycle.plantsCount > 0 && `${selectedRoom.plannedCycle.plantsCount} кустов`}
                          </div>
                        </div>
                      ) : (
                        <p className="text-dark-400 text-sm">План следующего цикла не задан</p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-dark-700">
                        <button
                          onClick={() => openPlanMode(selectedRoom)}
                          className="px-4 py-2 bg-dark-700 text-white rounded-lg hover:bg-dark-600 transition"
                        >
                          {selectedRoom.plannedCycle ? 'Изменить план' : 'Планировать'}
                        </button>
                        <button
                          onClick={startStartMode}
                          className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-500 transition font-medium"
                        >
                          Начать новый цикл
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно планирования цикла */}
      {planMode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60" onClick={closePlanMode}>
          <div
            className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-md p-6"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-1">Планирование цикла · {planMode.name}</h3>
            <p className="text-sm text-dark-400 mb-4">Следующий цикл в этой комнате</p>
            <form onSubmit={handlePlanSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-dark-400 mb-1">Название цикла</label>
                <input
                  type="text"
                  value={planForm.cycleName}
                  onChange={e => setPlanForm(f => ({ ...f, cycleName: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  placeholder="Например: Лето-2025"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Сорт</label>
                <input
                  type="text"
                  value={planForm.strain}
                  onChange={e => setPlanForm(f => ({ ...f, strain: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  placeholder="Название сорта"
                />
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Планируемая дата заезда</label>
                <input
                  type="date"
                  value={planForm.plannedStartDate}
                  onChange={e => setPlanForm(f => ({ ...f, plannedStartDate: e.target.value }))}
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
                    onChange={e => setPlanForm(f => ({ ...f, plantsCount: e.target.value }))}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-dark-400 mb-1">Дней цветения</label>
                  <input
                    type="number"
                    min="1"
                    value={planForm.floweringDays}
                    onChange={e => setPlanForm(f => ({ ...f, floweringDays: e.target.value }))}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-dark-400 mb-1">Заметки</label>
                <textarea
                  value={planForm.notes}
                  onChange={e => setPlanForm(f => ({ ...f, notes: e.target.value }))}
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
                {planMode.plannedCycle?._id && (
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
                  onClick={closePlanMode}
                  className="px-4 py-2 text-dark-400 hover:bg-dark-700 rounded-lg transition text-sm"
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
