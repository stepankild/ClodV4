/**
 * CrewInfographic — crew report after harvest completion.
 *
 * Props:
 *   crewData       - crewData object from completeSession response or archive
 *   roomSquareMeters - room area (m²)
 *   roomName       - room name
 *   strain         - strain(s)
 *   onClose        - close handler (only for modal after completion)
 *   embedded       - true = embedded in page (archive), false = modal
 */

import { useTranslation } from 'react-i18next';

const ROLE_EMOJIS = {
  cutting:  '✂️',
  room:     '🧹',
  carrying: '🚶',
  weighing: '⚖️',
  hooks:    '🪝',
  hanging:  '🧵',
  observer: '👁️',
};

const CrewInfographic = ({ crewData, roomSquareMeters, roomName, strain, onClose, embedded }) => {
  const { t, i18n } = useTranslation();

  if (!crewData || !crewData.members?.length) return null;

  const getRoleMeta = (role) => ({
    emoji: ROLE_EMOJIS[role] || '❓',
    label: t(`crewRoles.${role}`, role),
  });

  // ── Helpers ──

  function formatDuration(ms) {
    if (!ms || ms <= 0) return '—';
    const isEn = i18n.language === 'en';
    const totalMin = Math.round(ms / 60000);
    if (totalMin < 60) return `${totalMin} ${isEn ? 'min' : 'мин'}`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (isEn) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    return m > 0 ? `${h}ч ${m}м` : `${h}ч`;
  }

  function distanceComparison(meters) {
    if (!meters || meters <= 0) return null;
    if (meters < 1000) return `${meters} m`;
    const km = (meters / 1000).toFixed(1);
    const footballFields = Math.round(meters / 100);
    return `${km} km — ${footballFields} ⚽`;
  }

  function weightComparison(kg) {
    if (!kg || kg <= 0) return null;
    return `${kg} ${t('common.kg')}`;
  }

  function speedTier(plantsPerMin) {
    if (!plantsPerMin || plantsPerMin <= 0) return { emoji: '—', label: '' };
    if (plantsPerMin >= 3) return { emoji: '⚡', label: t('crew.speedLightning') };
    if (plantsPerMin >= 2) return { emoji: '🔥', label: t('crew.speedFire') };
    if (plantsPerMin >= 1) return { emoji: '👍', label: t('crew.speedGood') };
    return { emoji: '🐢', label: t('crew.speedSlow') };
  }

  const { members, metrics, distanceToScale, potWeight, branchesPerPlant, potsPerTrip, plantsPerTrip, sessionDurationMs } = crewData;
  const { totalPlants, totalWetWeight, totalBranches, potTrips, plantTrips, potDistanceM, plantDistanceM, totalWeightCarriedKg, avgRecordingSpeed, fastestPlantSec, slowestPlantSec } = metrics || {};

  const roleGroups = {};
  for (const m of members) {
    const role = m.role || 'observer';
    if (!roleGroups[role]) roleGroups[role] = [];
    roleGroups[role].push(m);
  }

  const uniqueMembers = {};
  for (const m of members) {
    const uid = m.user?.toString() || m.userName;
    uniqueMembers[uid] = m;
  }
  const teamSize = Object.keys(uniqueMembers).length;

  const renderRoleCard = (role, membersInRole) => {
    const meta = getRoleMeta(role);
    const names = membersInRole.map(m => m.userName || '—');
    const uniqueNames = [...new Set(names)];

    return (
      <div key={role} className="bg-dark-700/50 rounded-xl p-4 border border-dark-600">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl">{meta.emoji}</span>
          <div>
            <div className="text-white font-bold text-sm">{meta.label}</div>
            <div className="text-dark-400 text-xs">{uniqueNames.join(', ')}</div>
          </div>
        </div>
        <div className="space-y-1.5">
          {renderRoleMetrics(role, membersInRole)}
        </div>
      </div>
    );
  };

  const renderMetricRow = (label, value, highlight) => (
    <div className="flex items-center justify-between text-sm">
      <span className="text-dark-400">{label}</span>
      <span className={highlight ? 'text-green-400 font-medium' : 'text-white'}>{value}</span>
    </div>
  );

  const renderFunFact = (text) => (
    <div className="text-xs text-dark-500 mt-2 italic">{text}</div>
  );

  const renderRoleMetrics = (role, membersInRole) => {
    const totalDuration = membersInRole.reduce((sum, m) => sum + (m.durationMs || 0), 0);

    switch (role) {
      case 'cutting': {
        const cutMaxDuration = Math.max(...membersInRole.map(m => m.durationMs || 0));
        const speed = cutMaxDuration > 0 && totalPlants
          ? Math.round((totalPlants / (cutMaxDuration / 60000)) * 10) / 10
          : null;
        return (
          <>
            {renderMetricRow(t('crew.cutPlants'), totalPlants || '—')}
            {renderMetricRow(t('crew.time'), formatDuration(cutMaxDuration))}
            {speed != null && renderMetricRow(t('crew.speed'), `${speed} ${t('crew.plantPerMin')}`)}
          </>
        );
      }

      case 'room': {
        const roomMaxDuration = Math.max(...membersInRole.map(m => m.durationMs || 0));
        return (
          <>
            {roomSquareMeters && renderMetricRow(t('crew.roomArea'), `${roomSquareMeters} m²`)}
            {renderMetricRow(t('crew.potsCleared'), totalPlants || '—')}
            {renderMetricRow(t('crew.time'), formatDuration(roomMaxDuration))}
          </>
        );
      }

      case 'carrying': {
        const potCarriers = membersInRole.filter(m => m.carryType === 'pots' || m.carryType === 'both');
        const plantCarriers = membersInRole.filter(m => m.carryType === 'plants' || m.carryType === 'both');
        const unassigned = membersInRole.filter(m => !m.carryType);

        const showPots = potCarriers.length > 0 && potTrips;
        const showPlants = plantCarriers.length > 0 && plantTrips;

        const totalDistance = (potDistanceM || 0) + (plantDistanceM || 0);

        const potNames = potCarriers.map(m => m.userName).filter(Boolean);
        const plantNames = plantCarriers.map(m => m.userName).filter(Boolean);

        const maxDuration = Math.max(...membersInRole.map(m => m.durationMs || 0));

        return (
          <>
            {renderMetricRow(t('crew.time'), formatDuration(maxDuration))}
            {showPots && (
              <>
                <div className="text-xs text-dark-500 mt-2 mb-1 font-medium">🪴 {t('crew.potsLabel')} — {potNames.join(', ')}</div>
                {renderMetricRow(t('crew.potsCarried'), totalPlants)}
                {renderMetricRow(t('crew.trips'), potTrips)}
                {potsPerTrip && renderMetricRow(t('crew.perTrip'), potsPerTrip)}
                {potDistanceM && renderMetricRow(t('crew.distance'), `${potDistanceM} m`)}
                {totalWeightCarriedKg && renderMetricRow(t('crew.weightCarried'), `${totalWeightCarriedKg} ${t('common.kg')}`, true)}
              </>
            )}
            {showPlants && (
              <>
                <div className="text-xs text-dark-500 mt-2 mb-1 font-medium">🌿 {t('crew.plantsToScale')} — {plantNames.join(', ')}</div>
                {renderMetricRow(t('crew.plantsToScale'), totalPlants)}
                {renderMetricRow(t('crew.trips'), plantTrips)}
                {plantsPerTrip && renderMetricRow(t('crew.perTrip'), plantsPerTrip)}
                {plantDistanceM && renderMetricRow(t('crew.distance'), `${plantDistanceM} m`)}
              </>
            )}
            {unassigned.length > 0 && !showPots && !showPlants && (
              <>
                {distanceToScale && renderMetricRow(t('crew.distanceOneWay'), `${distanceToScale} m`)}
              </>
            )}
            {totalDistance > 0 && renderFunFact(distanceComparison(totalDistance))}
            {totalWeightCarriedKg > 0 && renderFunFact(weightComparison(totalWeightCarriedKg))}
          </>
        );
      }

      case 'weighing': {
        const speed = speedTier(avgRecordingSpeed);
        return (
          <>
            {renderMetricRow(t('crew.plantsWeighed'), totalPlants || '—')}
            {renderMetricRow(t('crew.time'), formatDuration(totalDuration))}
            {avgRecordingSpeed != null && renderMetricRow(t('crew.recordSpeed'), `${avgRecordingSpeed} ${t('crew.plantPerMin')} ${speed.emoji}`)}
            {fastestPlantSec != null && renderMetricRow(t('crew.fastestPlant'), `${fastestPlantSec} sec`)}
            {slowestPlantSec != null && renderMetricRow(t('crew.slowestPlant'), `${slowestPlantSec} sec`)}
            {speed.label && renderFunFact(`${speed.emoji} ${speed.label}`)}
          </>
        );
      }

      case 'hooks': {
        const hooksMaxDuration = Math.max(...membersInRole.map(m => m.durationMs || 0));
        return (
          <>
            {renderMetricRow(t('crew.plantsSplit'), totalPlants || '—')}
            {branchesPerPlant && renderMetricRow(t('crew.branchesPerPlant'), branchesPerPlant)}
            {totalBranches && renderMetricRow(t('crew.totalBranches'), totalBranches, true)}
            {renderMetricRow(t('crew.time'), formatDuration(hooksMaxDuration))}
          </>
        );
      }

      case 'hanging': {
        const hangMaxDuration = Math.max(...membersInRole.map(m => m.durationMs || 0));
        return (
          <>
            {totalBranches && renderMetricRow(t('crew.branchesHung'), `~${totalBranches}`)}
            {!totalBranches && totalPlants && renderMetricRow(t('crew.plantsAsBranches'), totalPlants)}
            {renderMetricRow(t('crew.time'), formatDuration(hangMaxDuration))}
          </>
        );
      }

      case 'observer': {
        return (
          <>
            {renderMetricRow(t('crew.observeTime'), formatDuration(totalDuration))}
            {renderFunFact(t('crew.moralSupport'))}
          </>
        );
      }

      default:
        return renderMetricRow(t('crew.time'), formatDuration(totalDuration));
    }
  };

  const content = (
    <div className={embedded ? '' : ''}>
      {/* Header */}
      {!embedded && (
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-green-600/20 flex items-center justify-center shrink-0">
            <span className="text-2xl">🎉</span>
          </div>
          <div>
            <h3 className="text-white font-bold text-lg">{t('crew.harvestDone')}</h3>
            <p className="text-dark-400 text-sm">
              {roomName && <span>{roomName}</span>}
              {strain && <span className="ml-2 text-primary-400">{strain}</span>}
            </p>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="bg-dark-700 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-white">{totalPlants || 0}</div>
          <div className="text-xs text-dark-400">{t('crew.plantsLabel')}</div>
        </div>
        <div className="bg-dark-700 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-green-400">{totalWetWeight ? `${(totalWetWeight / 1000).toFixed(1)} ${t('common.kg')}` : '—'}</div>
          <div className="text-xs text-dark-400">{t('crew.wetWeight')}</div>
        </div>
        <div className="bg-dark-700 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-primary-400">{formatDuration(sessionDurationMs)}</div>
          <div className="text-xs text-dark-400">{t('crew.duration')}</div>
        </div>
        <div className="bg-dark-700 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-yellow-400">{teamSize}</div>
          <div className="text-xs text-dark-400">{t('crew.teamMembers')}</div>
        </div>
      </div>

      {/* Role cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Object.entries(roleGroups).map(([role, membersInRole]) =>
          renderRoleCard(role, membersInRole)
        )}
      </div>

      {/* Close button */}
      {onClose && !embedded && (
        <button
          onClick={onClose}
          className="w-full mt-5 px-4 py-3 bg-dark-700 hover:bg-dark-600 text-dark-300 hover:text-white border border-dark-600 rounded-xl font-medium transition"
        >
          {t('common.close')}
        </button>
      )}
    </div>
  );

  if (embedded) {
    return content;
  }

  // Modal
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-dark-800 border-2 border-green-600 rounded-2xl p-6 max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        {content}
      </div>
    </div>
  );
};

export default CrewInfographic;
