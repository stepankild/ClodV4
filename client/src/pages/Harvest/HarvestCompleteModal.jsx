import { useState } from 'react';

const HarvestCompleteModal = ({ isOpen, onClose, onConfirm, loading, crew, isTestRoom }) => {
  const [distanceToScale, setDistanceToScale] = useState('');
  const [potWeight, setPotWeight] = useState('');
  const [branchesPerPlant, setBranchesPerPlant] = useState('');
  const [potsPerTrip, setPotsPerTrip] = useState('');
  const [plantsPerTrip, setPlantsPerTrip] = useState('');
  const [carrierAssignments, setCarrierAssignments] = useState({});

  if (!isOpen) return null;

  // Найти носильщиков (активных, т.е. последний entry для каждого юзера с ролью carrying)
  const carriers = (crew || []).filter(c => c.role === 'carrying');

  const handleCarrierChange = (userId, carryType) => {
    setCarrierAssignments(prev => ({ ...prev, [userId]: carryType }));
  };

  const handleSubmit = () => {
    const data = {};
    if (distanceToScale) data.distanceToScale = parseFloat(distanceToScale);
    if (potWeight) data.potWeight = parseFloat(potWeight);
    if (branchesPerPlant) data.branchesPerPlant = parseInt(branchesPerPlant, 10);
    if (potsPerTrip) data.potsPerTrip = parseInt(potsPerTrip, 10);
    if (plantsPerTrip) data.plantsPerTrip = parseInt(plantsPerTrip, 10);

    // Carrier assignments
    const assignments = Object.entries(carrierAssignments)
      .filter(([, type]) => type)
      .map(([userId, carryType]) => ({ userId, carryType }));
    if (assignments.length > 0) data.carrierAssignments = assignments;

    onConfirm(data);
  };

  // Для тестовых комнат — простое подтверждение
  if (isTestRoom) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-dark-800 border-2 border-amber-600 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-amber-600/20 flex items-center justify-center shrink-0">
              <span className="text-2xl">🧪</span>
            </div>
            <div>
              <h3 className="text-white font-bold text-lg">Завершить тестовый сбор?</h3>
              <p className="text-amber-400 text-sm mt-1">Данные НЕ попадут в архив. Комната будет сброшена.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-3 bg-dark-700 hover:bg-dark-600 text-dark-300 hover:text-white rounded-xl font-medium transition disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              onClick={() => onConfirm({})}
              disabled={loading}
              className="flex-1 px-4 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold transition disabled:opacity-50"
            >
              {loading ? 'Завершение...' : 'Завершить тест'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-dark-800 border-2 border-green-600 rounded-2xl p-6 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-full bg-green-600/20 flex items-center justify-center shrink-0">
            <span className="text-2xl">🎉</span>
          </div>
          <div>
            <h3 className="text-white font-bold text-lg">Завершить сбор?</h3>
            <p className="text-dark-400 text-sm mt-0.5">
              Комната попадёт в архив. Данные ниже — для отчёта команды (необязательно).
            </p>
          </div>
        </div>

        <div className="space-y-4 mt-5">
          {/* Расстояние */}
          <div>
            <label className="flex items-center gap-2 text-sm text-dark-300 mb-1.5">
              <span>📏</span> Расстояние от комнаты до весов (м)
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={distanceToScale}
              onChange={e => setDistanceToScale(e.target.value)}
              placeholder="15"
              className="w-full px-3 py-2.5 bg-dark-700 border border-dark-600 rounded-lg text-white focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>

          {/* Вес горшка */}
          <div>
            <label className="flex items-center gap-2 text-sm text-dark-300 mb-1.5">
              <span>⚖️</span> Средний вес горшка с растением (кг)
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={potWeight}
              onChange={e => setPotWeight(e.target.value)}
              placeholder="4"
              className="w-full px-3 py-2.5 bg-dark-700 border border-dark-600 rounded-lg text-white focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>

          {/* Ветки с куста */}
          <div>
            <label className="flex items-center gap-2 text-sm text-dark-300 mb-1.5">
              <span>🪝</span> Среднее кол-во веток с куста
            </label>
            <input
              type="number"
              min="1"
              value={branchesPerPlant}
              onChange={e => setBranchesPerPlant(e.target.value)}
              placeholder="8"
              className="w-full px-3 py-2.5 bg-dark-700 border border-dark-600 rounded-lg text-white focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>

          {/* Горшков за ходку */}
          <div>
            <label className="flex items-center gap-2 text-sm text-dark-300 mb-1.5">
              <span>🪴</span> Горшков за одну ходку
            </label>
            <input
              type="number"
              min="1"
              value={potsPerTrip}
              onChange={e => setPotsPerTrip(e.target.value)}
              placeholder="2"
              className="w-full px-3 py-2.5 bg-dark-700 border border-dark-600 rounded-lg text-white focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>

          {/* Кустов за ходку */}
          <div>
            <label className="flex items-center gap-2 text-sm text-dark-300 mb-1.5">
              <span>🌿</span> Кустов за одну ходку
            </label>
            <input
              type="number"
              min="1"
              value={plantsPerTrip}
              onChange={e => setPlantsPerTrip(e.target.value)}
              placeholder="3"
              className="w-full px-3 py-2.5 bg-dark-700 border border-dark-600 rounded-lg text-white focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>

          {/* Секция носильщиков */}
          {carriers.length > 0 && (
            <div className="pt-3 border-t border-dark-700">
              <div className="text-sm text-dark-300 mb-3 font-medium">
                🚶 Носильщики — что нёс каждый?
              </div>
              <div className="space-y-3">
                {carriers.map(c => {
                  const uid = c.user?._id || c.user;
                  const name = c.user?.name || '—';
                  return (
                    <div key={uid} className="flex items-center gap-3 bg-dark-700/50 rounded-lg p-3">
                      <span className="text-white text-sm font-medium min-w-0 truncate flex-shrink">{name}</span>
                      <select
                        value={carrierAssignments[uid] || ''}
                        onChange={e => handleCarrierChange(uid, e.target.value)}
                        className="flex-1 px-2 py-2 bg-dark-600 border border-dark-500 rounded-lg text-white text-sm focus:ring-2 focus:ring-green-500"
                      >
                        <option value="">Не указано</option>
                        <option value="pots">🪴 Горшки к весам</option>
                        <option value="plants">🌿 Кусты на сушку</option>
                        <option value="both">🔄 Оба</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-3 bg-dark-700 hover:bg-dark-600 text-dark-300 hover:text-white rounded-xl font-medium transition disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-bold transition disabled:opacity-50"
          >
            {loading ? 'Завершение...' : 'Завершить сбор ✓'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default HarvestCompleteModal;
