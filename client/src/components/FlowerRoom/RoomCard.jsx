import { useState } from 'react';

const RoomCard = ({ room, onUpdate, onStartCycle, onHarvest }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [formData, setFormData] = useState({
    strain: room.strain || '',
    plantsCount: room.plantsCount || 0,
    floweringDays: room.floweringDays || 56,
    notes: room.notes || '',
    startDate: room.startDate ? new Date(room.startDate).toISOString().split('T')[0] : ''
  });
  const [startData, setStartData] = useState({
    strain: '',
    plantsCount: 0,
    floweringDays: 56,
    notes: ''
  });

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

  const handleStart = async () => {
    await onStartCycle(room._id, startData);
    setIsStarting(false);
    setStartData({ strain: '', plantsCount: 0, floweringDays: 56, notes: '' });
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
              onClick={() => setIsEditing(true)}
              className="p-2 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
        </div>
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

            {/* Harvest button */}
            {room.progress >= 100 && (
              <button
                onClick={() => onHarvest(room._id)}
                className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-500 transition font-medium flex items-center justify-center space-x-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Собрать урожай</span>
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
    </div>
  );
};

export default RoomCard;
