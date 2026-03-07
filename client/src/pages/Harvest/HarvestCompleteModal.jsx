import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const HarvestCompleteModal = ({ isOpen, onClose, onConfirm, loading, crew }) => {
  const { t } = useTranslation();
  const [distanceToScale, setDistanceToScale] = useState('');
  const [potWeight, setPotWeight] = useState('');
  const [branchesPerPlant, setBranchesPerPlant] = useState('');
  const [potsPerTrip, setPotsPerTrip] = useState('');
  const [plantsPerTrip, setPlantsPerTrip] = useState('');
  const [carrierAssignments, setCarrierAssignments] = useState({});

  if (!isOpen) return null;

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

    const assignments = Object.entries(carrierAssignments)
      .filter(([, type]) => type)
      .map(([userId, carryType]) => ({ userId, carryType }));
    if (assignments.length > 0) data.carrierAssignments = assignments;

    onConfirm(data);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-dark-800 border-2 border-green-600 rounded-2xl p-6 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-full bg-green-600/20 flex items-center justify-center shrink-0">
            <span className="text-2xl">🎉</span>
          </div>
          <div>
            <h3 className="text-white font-bold text-lg">{t('harvestComplete.finishTitle')}</h3>
            <p className="text-dark-400 text-sm mt-0.5">
              {t('harvestComplete.finishNote')}
            </p>
          </div>
        </div>

        <div className="space-y-4 mt-5">
          <div>
            <label className="flex items-center gap-2 text-sm text-dark-300 mb-1.5">
              <span>📏</span> {t('harvestComplete.distanceToScale')}
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

          <div>
            <label className="flex items-center gap-2 text-sm text-dark-300 mb-1.5">
              <span>⚖️</span> {t('harvestComplete.avgPotWeight')}
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

          <div>
            <label className="flex items-center gap-2 text-sm text-dark-300 mb-1.5">
              <span>🪝</span> {t('harvestComplete.branchesPerPlant')}
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

          <div>
            <label className="flex items-center gap-2 text-sm text-dark-300 mb-1.5">
              <span>🪴</span> {t('harvestComplete.potsPerTrip')}
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

          <div>
            <label className="flex items-center gap-2 text-sm text-dark-300 mb-1.5">
              <span>🌿</span> {t('harvestComplete.plantsPerTrip')}
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

          {carriers.length > 0 && (
            <div className="pt-3 border-t border-dark-700">
              <div className="text-sm text-dark-300 mb-3 font-medium">
                🚶 {t('harvestComplete.carriers')}
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
                        <option value="">{t('harvestComplete.notSpecified')}</option>
                        <option value="pots">{t('harvestComplete.pots')}</option>
                        <option value="plants">{t('harvestComplete.plants')}</option>
                        <option value="both">{t('harvestComplete.both')}</option>
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
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-bold transition disabled:opacity-50"
          >
            {loading ? t('harvestComplete.finishing') : t('harvestComplete.finishBtn')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default HarvestCompleteModal;
