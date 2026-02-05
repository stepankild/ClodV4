import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { roomService } from '../../services/roomService';
import { taskService } from '../../services/taskService';
import { archiveService } from '../../services/archiveService';
import { taskTypes } from '../../services/taskService';

const RoomCard = ({ room, onUpdate, onStartCycle, onHarvest, onArchiveComplete }) => {
  const { hasPermission } = useAuth();
  const canEditCycleName = hasPermission('cycles:edit_name');
  const canEditWeights = hasPermission('harvest:edit_weights');
  const [isEditing, setIsEditing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const [roomDetail, setRoomDetail] = useState(null);
  const [addActionForm, setAddActionForm] = useState(null);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveForm, setArchiveForm] = useState({
    cycleName: '',
    wetWeight: '',
    dryWeight: '',
    trimWeight: '',
    quality: 'medium',
    harvestNotes: ''
  });
  const [formData, setFormData] = useState({
    cycleName: room.cycleName || '',
    strain: room.strain || '',
    plantsCount: room.plantsCount || 0,
    floweringDays: room.floweringDays || 56,
    notes: room.notes || '',
    startDate: room.startDate ? new Date(room.startDate).toISOString().split('T')[0] : ''
  });
  const [startData, setStartData] = useState({
    cycleName: '',
    strain: '',
    plantsCount: 0,
    floweringDays: 56,
    notes: ''
  });
  const [inlineCycleName, setInlineCycleName] = useState(room.cycleName || '');

  useEffect(() => {
    setInlineCycleName(room.cycleName || '');
  }, [room.cycleName]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleStartChange = (e) => {
    const { name, value } = e.target;
    setStartData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    await onUpdate(room._id, formData);
    setIsEditing(false);
  };

  const handleCycleNameBlur = async () => {
    const value = (inlineCycleName || '').trim();
    if (value === (room.cycleName || '').trim()) return;
    try {
      await onUpdate(room._id, { cycleName: value });
    } catch (err) {
      console.error(err);
      setInlineCycleName(room.cycleName || '');
    }
  };

  const handleStart = async () => {
    await onStartCycle(room._id, startData);
    setIsStarting(false);
    setStartData({ cycleName: '', strain: '', plantsCount: 0, floweringDays: 56, notes: '' });
  };

  const formatDate = (date) => {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('ru-RU');
  };

  const getProgressColor = (progress) => {
    if (progress < 30) return 'bg-blue-500';
    if (progress < 60) return 'bg-yellow-500';
    if (progress < 90) return 'bg-orange-500';
    return 'bg-green-500';
  };

  // Загружаем задачи для активной комнаты всегда (обзор состояния фермы)
  useEffect(() => {
    if (room.isActive && room._id) {
      setActionsLoading(true);
      roomService.getRoom(room._id)
        .then((data) => { setRoomDetail(data); setActionsLoading(false); })
        .catch(() => { setRoomDetail(null); setActionsLoading(false); });
    } else {
      setRoomDetail(null);
      setActionsLoading(false);
    }
  }, [room.isActive, room._id]);

  const tasks = roomDetail?.tasks || [];
  const tasksByType = taskTypes.reduce((acc, { value }) => {
    acc[value] = tasks.filter(t => t.type === value && t.completed);
    return acc;
  }, {});

  const handleAddAction = async (e) => {
    e.preventDefault();
    if (!addActionForm?.type) return;
    try {
      await taskService.quickAddTask(room._id, {
        type: addActionForm.type,
        completedAt: addActionForm.completedAt || new Date().toISOString().slice(0, 10),
        product: addActionForm.product,
        dosage: addActionForm.dosage
      });
      const data = await roomService.getRoom(room._id);
      setRoomDetail(data);
      setAddActionForm(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTask = async (taskId) => {
    try {
      await taskService.deleteTask(taskId);
      const data = await roomService.getRoom(room._id);
      setRoomDetail(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleArchiveSubmit = async (e) => {
    e.preventDefault();
    try {
      const { archive, room: updatedRoom } = await archiveService.harvestAndArchive(room._id, {
        cycleName: (archiveForm.cycleName && archiveForm.cycleName.trim()) || room.cycleName,
        wetWeight: Number(archiveForm.wetWeight) || 0,
        dryWeight: Number(archiveForm.dryWeight) || 0,
        trimWeight: Number(archiveForm.trimWeight) || 0,
        quality: archiveForm.quality,
        harvestNotes: archiveForm.harvestNotes
      });
      setArchiveModalOpen(false);
      setArchiveForm({ cycleName: '', wetWeight: '', dryWeight: '', trimWeight: '', quality: 'medium', harvestNotes: '' });
      if (onArchiveComplete) onArchiveComplete(updatedRoom);
    } catch (err) {
      console.error(err);
    }
  };

  // Start new cycle form
  if (isStarting) {
    return (
      <div className="bg-dark-800 rounded-xl p-6 border border-dark-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">{room.name}</h3>
          <button
            onClick={() => setIsStarting(false)}
            className="text-dark-400 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-dark-400 mb-1">Название / код цикла</label>
            <input
              type="text"
              name="cycleName"
              value={startData.cycleName}
              onChange={handleStartChange}
              readOnly={!canEditCycleName}
              className={`w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent ${!canEditCycleName ? 'opacity-75 cursor-not-allowed' : ''}`}
              placeholder={canEditCycleName ? 'Например: Весна-2025, A-001' : 'Только админ может задать название'}
            />
          </div>
          <div>
            <label className="block text-sm text-dark-400 mb-1">Сорт</label>
            <input
              type="text"
              name="strain"
              value={startData.strain}
              onChange={handleStartChange}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Название сорта"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-dark-400 mb-1">Кустов</label>
              <input
                type="number"
                name="plantsCount"
                value={startData.plantsCount}
                onChange={handleStartChange}
                min="0"
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm text-dark-400 mb-1">Дней цветения</label>
              <input
                type="number"
                name="floweringDays"
                value={startData.floweringDays}
                onChange={handleStartChange}
                min="1"
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-dark-400 mb-1">Заметки</label>
            <textarea
              name="notes"
              value={startData.notes}
              onChange={handleStartChange}
              rows={2}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              placeholder="Заметки по комнате..."
            />
          </div>

          <button
            onClick={handleStart}
            className="w-full bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-500 transition font-medium"
          >
            Начать цикл
          </button>
        </div>
      </div>
    );
  }

  // Edit mode
  if (isEditing) {
    return (
      <div className="bg-dark-800 rounded-xl p-6 border border-dark-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">{room.name}</h3>
          <button
            onClick={() => setIsEditing(false)}
            className="text-dark-400 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-dark-400 mb-1">Название / код цикла</label>
            <input
              type="text"
              name="cycleName"
              value={formData.cycleName}
              onChange={handleChange}
              readOnly={!canEditCycleName}
              className={`w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent ${!canEditCycleName ? 'opacity-75 cursor-not-allowed' : ''}`}
              placeholder="Например: Весна-2025"
            />
          </div>
          <div>
            <label className="block text-sm text-dark-400 mb-1">Сорт</label>
            <input
              type="text"
              name="strain"
              value={formData.strain}
              onChange={handleChange}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-dark-400 mb-1">Кустов</label>
              <input
                type="number"
                name="plantsCount"
                value={formData.plantsCount}
                onChange={handleChange}
                min="0"
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm text-dark-400 mb-1">Дней цветения</label>
              <input
                type="number"
                name="floweringDays"
                value={formData.floweringDays}
                onChange={handleChange}
                min="1"
                className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-dark-400 mb-1">Дата заезда</label>
            <input
              type="date"
              name="startDate"
              value={formData.startDate}
              onChange={handleChange}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm text-dark-400 mb-1">Заметки</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={2}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          </div>

          <button
            onClick={handleSave}
            className="w-full bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-500 transition font-medium"
          >
            Сохранить
          </button>
        </div>
      </div>
    );
  }

  // Normal view
  return (
    <div className={`bg-dark-800 rounded-xl p-6 border ${room.isActive ? 'border-primary-700' : 'border-dark-700'} transition-all hover:border-dark-600`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${room.isActive ? 'bg-primary-500 animate-pulse' : 'bg-dark-600'}`}></div>
          <h3 className="text-lg font-semibold text-white">{room.name}</h3>
        </div>
        <div className="flex items-center space-x-2">
          {room.isActive && (
            <button
              onClick={() => {
                setFormData({
                  cycleName: room.cycleName || '',
                  strain: room.strain || '',
                  plantsCount: room.plantsCount || 0,
                  floweringDays: room.floweringDays || 56,
                  notes: room.notes || '',
                  startDate: room.startDate ? new Date(room.startDate).toISOString().split('T')[0] : ''
                });
                setIsEditing(true);
              }}
              className="p-2 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Слот «Название цикла» — всегда виден, у активных комнат можно редактировать */}
      <div className="mb-4 rounded-lg px-3 py-2.5 border bg-dark-700/40 border-dark-600">
        <label className="block text-xs text-dark-400 mb-1">Название цикла</label>
        {room.isActive ? (
          canEditCycleName ? (
            <input
              type="text"
              value={inlineCycleName}
              onChange={(e) => setInlineCycleName(e.target.value)}
              onBlur={handleCycleNameBlur}
              onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
              className="w-full bg-dark-800/80 text-white font-medium rounded px-2 py-1.5 border border-dark-600 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none placeholder:text-dark-500 text-sm"
              placeholder="Введите название цикла (например: Весна-2025)"
            />
          ) : (
            <div className="text-white font-medium text-sm py-1">{room.cycleName || '—'}</div>
          )
        ) : (
          <div className="text-dark-500 text-sm py-1">— Задаётся при старте цикла</div>
        )}
      </div>

      {room.isActive ? (
        <>
          {/* Active room content */}
          <div className="space-y-4">
            {/* Strain & Plants */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-dark-400">Сорт</div>
                <div className="text-white font-medium">{room.strain || '—'}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-dark-400">Кустов</div>
                <div className="text-white font-medium">{room.plantsCount}</div>
              </div>
            </div>

            {/* Dates */}
            <div className="flex items-center justify-between text-sm">
              <div>
                <div className="text-dark-400">Заезд</div>
                <div className="text-white">{formatDate(room.startDate)}</div>
              </div>
              <div className="text-right">
                <div className="text-dark-400">Урожай</div>
                <div className="text-white">{formatDate(room.expectedHarvestDate)}</div>
              </div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-dark-400">День {room.currentDay} из {room.floweringDays}</span>
                <span className="text-white font-medium">{room.progress}%</span>
              </div>
              <div className="w-full h-2 bg-dark-700 rounded-full overflow-hidden">
                <div
                  className={`h-full ${getProgressColor(room.progress)} transition-all duration-500`}
                  style={{ width: `${room.progress}%` }}
                ></div>
              </div>
              {room.daysRemaining !== null && room.daysRemaining > 0 && (
                <div className="text-xs text-dark-500 mt-1">
                  Осталось {room.daysRemaining} дней
                </div>
              )}
            </div>

            {/* Notes */}
            {room.notes && (
              <div className="bg-dark-700/50 rounded-lg p-3">
                <div className="text-xs text-dark-400 mb-1">Заметки</div>
                <div className="text-sm text-dark-200">{room.notes}</div>
              </div>
            )}

            {/* Обзор состояния: вехи нед.2 / нед.4 и обработки (всегда видно) */}
            <div className="border-t border-dark-700 pt-4 space-y-3">
              <div className="text-xs font-semibold text-dark-400 uppercase tracking-wider">Обзор состояния</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-dark-700/50 rounded-lg px-3 py-2">
                  <div className="text-dark-400 text-xs">Неделя 2: Подрезка</div>
                  <div className="text-white font-medium">
                    {(() => {
                      const t = tasks.find(x => x.type === 'trim' && x.completed);
                      return t ? formatDate(t.completedAt) : '—';
                    })()}
                  </div>
                </div>
                <div className="bg-dark-700/50 rounded-lg px-3 py-2">
                  <div className="text-dark-400 text-xs">Неделя 4: Убрать листики</div>
                  <div className="text-white font-medium">
                    {(() => {
                      const t = tasks.find(x => x.type === 'defoliation' && x.completed);
                      return t ? formatDate(t.completedAt) : '—';
                    })()}
                  </div>
                </div>
              </div>
              <div>
                <div className="text-dark-400 text-xs mb-1">Обработки (чем и когда)</div>
                {actionsLoading ? (
                  <div className="text-dark-500 text-xs">Загрузка...</div>
                ) : (tasks.filter(t => t.completed).length === 0) ? (
                  <div className="text-dark-500 text-xs">Пока нет</div>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {[...tasks.filter(t => t.completed)]
                      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
                      .map((t) => (
                        <li key={t._id} className="flex items-center gap-2 text-dark-200">
                          <span className="text-green-400 shrink-0">✓</span>
                          <span>
                            {t.type === 'spray' && t.sprayProduct ? `Опрыскивание: ${t.sprayProduct}` : t.type === 'feed' && t.feedProduct ? `Подкормка: ${t.feedProduct}` : t.title}
                          </span>
                          <span className="text-dark-500">{formatDate(t.completedAt)}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Actions section (добавить новую галочку) */}
            <div className="border-t border-dark-700 pt-4">
              <button
                type="button"
                onClick={() => setActionsExpanded(!actionsExpanded)}
                className="flex items-center justify-between w-full text-left text-sm font-medium text-dark-300 hover:text-white"
              >
                <span>Действия по комнате</span>
                <svg className={`w-5 h-5 transition-transform ${actionsExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {actionsExpanded && (
                <div className="mt-3 space-y-3">
                  {room.isActive && actionsLoading && (
                    <div className="text-center py-2 text-dark-400 text-sm">Загрузка действий...</div>
                  )}
                  {taskTypes.map(({ value, label }) => (
                    <div key={value} className="bg-dark-700/50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-white">{label}</span>
                        {addActionForm?.type === value ? (
                          <button type="button" onClick={() => setAddActionForm(null)} className="text-xs text-dark-400 hover:text-white">Отмена</button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setAddActionForm({
                              type: value,
                              completedAt: new Date().toISOString().slice(0, 10),
                              product: '',
                              dosage: ''
                            })}
                            className="text-xs text-primary-400 hover:text-primary-300"
                          >
                            Отметить
                          </button>
                        )}
                      </div>
                      {addActionForm?.type === value && (
                        <form onSubmit={handleAddAction} className="space-y-2 mb-2">
                          <input
                            type="date"
                            value={addActionForm.completedAt}
                            onChange={(e) => setAddActionForm(f => ({ ...f, completedAt: e.target.value }))}
                            className="w-full px-2 py-1.5 bg-dark-600 border border-dark-500 rounded text-white text-sm"
                          />
                          {(value === 'spray' || value === 'feed') && (
                            <input
                              type="text"
                              placeholder={value === 'spray' ? 'Средство' : 'Удобрение'}
                              value={addActionForm.product}
                              onChange={(e) => setAddActionForm(f => ({ ...f, product: e.target.value }))}
                              className="w-full px-2 py-1.5 bg-dark-600 border border-dark-500 rounded text-white text-sm"
                            />
                          )}
                          {value === 'feed' && (
                            <input
                              type="text"
                              placeholder="Дозировка"
                              value={addActionForm.dosage}
                              onChange={(e) => setAddActionForm(f => ({ ...f, dosage: e.target.value }))}
                              className="w-full px-2 py-1.5 bg-dark-600 border border-dark-500 rounded text-white text-sm"
                            />
                          )}
                          <button type="submit" className="w-full py-1.5 bg-primary-600 text-white text-sm rounded hover:bg-primary-500">
                            Сохранить
                          </button>
                        </form>
                      )}
                      <div className="space-y-1">
                        {(tasksByType[value] || []).map((t) => (
                          <div key={t._id} className="flex items-center justify-between text-xs bg-dark-600 rounded px-2 py-1.5">
                            <span className="text-dark-200">
                              {formatDate(t.completedAt)}
                              {t.sprayProduct && ` — ${t.sprayProduct}`}
                              {t.feedProduct && ` — ${t.feedProduct}${t.feedDosage ? ` (${t.feedDosage})` : ''}`}
                            </span>
                            <button type="button" onClick={() => handleDeleteTask(t._id)} className="text-red-400 hover:text-red-300" title="Удалить">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Сбор урожая (привязано к комнате) */}
            {room.isActive && (
              <Link
                to={`/harvest?roomId=${room._id}`}
                className="w-full bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-500 transition font-medium flex items-center justify-center space-x-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                </svg>
                <span>Сбор урожая</span>
              </Link>
            )}
            {/* Архивировать цикл */}
            {room.progress >= 100 && (
              <button
                onClick={() => {
                  setArchiveForm(prev => ({ ...prev, cycleName: room.cycleName || '' }));
                  setArchiveModalOpen(true);
                }}
                className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-500 transition font-medium flex items-center justify-center space-x-2 mt-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Архивировать цикл</span>
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Empty room */}
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-16 h-16 bg-dark-700 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-dark-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <p className="text-dark-400 mb-4">Комната свободна</p>
            <button
              onClick={() => setIsStarting(true)}
              className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-500 transition font-medium"
            >
              Начать цикл
            </button>
          </div>
        </>
      )}

      {/* Archive modal */}
      {archiveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setArchiveModalOpen(false)}>
          <div className="bg-dark-800 rounded-xl border border-dark-600 shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4">Архивировать цикл</h3>
            <p className="text-sm text-dark-400 mb-4">Укажите данные урожая. Цикл попадёт в «Собрано», комната станет свободной для следующего.</p>
            <form onSubmit={handleArchiveSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-dark-400 mb-1">Название / код цикла в архиве</label>
                <input
                  type="text"
                  value={archiveForm.cycleName}
                  onChange={(e) => setArchiveForm(f => ({ ...f, cycleName: e.target.value }))}
                  readOnly={!canEditCycleName}
                  className={`w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm ${!canEditCycleName ? 'opacity-75 cursor-not-allowed' : ''}`}
                  placeholder="Например: Весна-2025, A-001"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-dark-400 mb-1">Вес сырой (г)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={archiveForm.wetWeight}
                    onChange={(e) => setArchiveForm(f => ({ ...f, wetWeight: e.target.value }))}
                    readOnly={!canEditWeights}
                    className={`w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm ${!canEditWeights ? 'opacity-75 cursor-not-allowed' : ''}`}
                  />
                </div>
                <div>
                  <label className="block text-sm text-dark-400 mb-1">Вес сухой (г)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={archiveForm.dryWeight}
                    onChange={(e) => setArchiveForm(f => ({ ...f, dryWeight: e.target.value }))}
                    readOnly={!canEditWeights}
                    className={`w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm ${!canEditWeights ? 'opacity-75 cursor-not-allowed' : ''}`}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-dark-400 mb-1">Трим (г)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={archiveForm.trimWeight}
                  onChange={(e) => setArchiveForm(f => ({ ...f, trimWeight: e.target.value }))}
                  readOnly={!canEditWeights}
                  className={`w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm ${!canEditWeights ? 'opacity-75 cursor-not-allowed' : ''}`}
                />
              </div>
              <div>
                <label className="block text-sm text-dark-400 mb-1">Качество</label>
                <select
                  value={archiveForm.quality}
                  onChange={(e) => setArchiveForm(f => ({ ...f, quality: e.target.value }))}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm"
                >
                  <option value="low">Низкое</option>
                  <option value="medium">Среднее</option>
                  <option value="high">Высокое</option>
                  <option value="premium">Премиум</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-dark-400 mb-1">Заметки к урожаю</label>
                <textarea
                  value={archiveForm.harvestNotes}
                  onChange={(e) => setArchiveForm(f => ({ ...f, harvestNotes: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setArchiveModalOpen(false)} className="flex-1 py-2 rounded-lg border border-dark-600 text-dark-300 hover:bg-dark-700">
                  Отмена
                </button>
                <button type="submit" className="flex-1 py-2 rounded-lg bg-green-600 text-white hover:bg-green-500 font-medium">
                  Архивировать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomCard;
