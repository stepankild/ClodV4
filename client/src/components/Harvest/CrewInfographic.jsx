/**
 * CrewInfographic — отчёт по команде после завершения сбора урожая.
 *
 * Props:
 *   crewData       - объект crewData из ответа completeSession или из архива
 *   roomSquareMeters - площадь комнаты (м²)
 *   roomName       - название комнаты
 *   strain         - сорт(а)
 *   onClose        - закрыть (только для модалки после завершения)
 *   embedded       - true = встроено в страницу (архив), false = модалка
 */

const ROLE_META = {
  cutting:   { emoji: '✂️', label: 'Срезка' },
  room:      { emoji: '🧹', label: 'В комнате' },
  carrying:  { emoji: '🚶', label: 'Носить' },
  weighing:  { emoji: '⚖️', label: 'Взвешивание' },
  hooks:     { emoji: '🪝', label: 'Крючки' },
  hanging:   { emoji: '🧵', label: 'Развеска' },
  observer:  { emoji: '👁️', label: 'Наблюдатель' },
};

// ── Helpers ──

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin} мин`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`;
}

function distanceComparison(meters) {
  if (!meters || meters <= 0) return null;
  if (meters < 100) return `${meters} м — как до соседней комнаты`;
  if (meters < 500) return `${meters} м — как до ближайшего магазина 🏪`;
  if (meters < 1000) return `${meters} м — полпути до километра!`;
  const km = (meters / 1000).toFixed(1);
  const footballFields = Math.round(meters / 100);
  return `${km} км — ${footballFields} футбольных полей ⚽`;
}

function weightComparison(kg) {
  if (!kg || kg <= 0) return null;
  if (kg < 20) return `${kg} кг — как ${Math.round(kg / 5)} бутылей воды 💧`;
  if (kg < 100) return `${kg} кг — как ${Math.round(kg / 25)} мешков цемента 🏗️`;
  return `${kg} кг — как ${Math.round(kg / 80)} человек 🏋️`;
}

function speedTier(plantsPerMin) {
  if (!plantsPerMin || plantsPerMin <= 0) return { emoji: '—', label: '' };
  if (plantsPerMin >= 3) return { emoji: '⚡', label: 'Молния!' };
  if (plantsPerMin >= 2) return { emoji: '🔥', label: 'Огонь!' };
  if (plantsPerMin >= 1) return { emoji: '👍', label: 'Хорошо' };
  return { emoji: '🐢', label: 'Не торопится' };
}

const CrewInfographic = ({ crewData, roomSquareMeters, roomName, strain, onClose, embedded }) => {
  if (!crewData || !crewData.members?.length) return null;

  const { members, metrics, distanceToScale, potWeight, branchesPerPlant, potsPerTrip, plantsPerTrip, sessionDurationMs } = crewData;
  const { totalPlants, totalWetWeight, totalBranches, potTrips, plantTrips, potDistanceM, plantDistanceM, totalWeightCarriedKg, avgRecordingSpeed, fastestPlantSec, slowestPlantSec } = metrics || {};

  // Группируем по ролям (учитываем что один человек мог иметь несколько записей)
  const roleGroups = {};
  for (const m of members) {
    const role = m.role || 'observer';
    if (!roleGroups[role]) roleGroups[role] = [];
    roleGroups[role].push(m);
  }

  // Роль "Последняя" для каждого юзера (для отображения имени)
  const uniqueMembers = {};
  for (const m of members) {
    const uid = m.user?.toString() || m.userName;
    // Храним последнюю запись
    uniqueMembers[uid] = m;
  }
  const teamSize = Object.keys(uniqueMembers).length;

  const renderRoleCard = (role, membersInRole) => {
    const meta = ROLE_META[role] || { emoji: '❓', label: role };
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
        const speed = totalDuration > 0 && totalPlants
          ? Math.round((totalPlants / (totalDuration / 60000)) * 10) / 10
          : null;
        return (
          <>
            {renderMetricRow('Кустов срезано', totalPlants || '—')}
            {renderMetricRow('Время', formatDuration(totalDuration))}
            {speed != null && renderMetricRow('Скорость', `${speed} куст/мин`)}
          </>
        );
      }

      case 'room': {
        return (
          <>
            {roomSquareMeters && renderMetricRow('Площадь комнаты', `${roomSquareMeters} м²`)}
            {renderMetricRow('Горшков убрано', totalPlants || '—')}
            {renderMetricRow('Время', formatDuration(totalDuration))}
            {roomSquareMeters && renderFunFact(`Убрали ${roomSquareMeters} кв. метров 🧹`)}
          </>
        );
      }

      case 'carrying': {
        // Разделяем по carryType
        const potCarriers = membersInRole.filter(m => m.carryType === 'pots' || m.carryType === 'both');
        const plantCarriers = membersInRole.filter(m => m.carryType === 'plants' || m.carryType === 'both');
        const bothCarriers = membersInRole.filter(m => m.carryType === 'both');

        // Расстояние для каждого типа
        const showPots = potCarriers.length > 0 && potTrips;
        const showPlants = plantCarriers.length > 0 && plantTrips;

        // Если у нас оба типа или неизвестный тип — показываем всё
        const totalDistance = (potDistanceM || 0) + (plantDistanceM || 0);
        const carrierNames = membersInRole.map(m => m.userName).filter(Boolean);

        return (
          <>
            {renderMetricRow('Время', formatDuration(totalDuration))}
            {showPots && (
              <>
                {renderMetricRow('🪴 Горшков вынесено', totalPlants)}
                {renderMetricRow('Ходок (горшки)', potTrips)}
                {potsPerTrip && renderMetricRow('Горшков за ходку', potsPerTrip)}
                {potDistanceM && renderMetricRow('Расстояние (горшки)', `${potDistanceM} м`)}
                {totalWeightCarriedKg && renderMetricRow('Перенесено веса', `${totalWeightCarriedKg} кг`, true)}
              </>
            )}
            {showPlants && (
              <>
                {renderMetricRow('🌿 Кустов к весам', totalPlants)}
                {renderMetricRow('Ходок (кусты)', plantTrips)}
                {plantsPerTrip && renderMetricRow('Кустов за ходку', plantsPerTrip)}
                {plantDistanceM && renderMetricRow('Расстояние (кусты)', `${plantDistanceM} м`)}
              </>
            )}
            {!showPots && !showPlants && (
              <>
                {distanceToScale && renderMetricRow('Расстояние в одну сторону', `${distanceToScale} м`)}
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
            {renderMetricRow('Кустов взвешено', totalPlants || '—')}
            {renderMetricRow('Время', formatDuration(totalDuration))}
            {avgRecordingSpeed != null && renderMetricRow('Скорость записи', `${avgRecordingSpeed} куст/мин ${speed.emoji}`)}
            {fastestPlantSec != null && renderMetricRow('Самый быстрый куст', `${fastestPlantSec} сек`)}
            {slowestPlantSec != null && renderMetricRow('Самый медленный куст', `${slowestPlantSec} сек`)}
            {speed.label && renderFunFact(`${speed.emoji} ${speed.label}`)}
          </>
        );
      }

      case 'hooks': {
        return (
          <>
            {renderMetricRow('Кустов разделено', totalPlants || '—')}
            {branchesPerPlant && renderMetricRow('Веток с куста', branchesPerPlant)}
            {totalBranches && renderMetricRow('Всего веток', totalBranches, true)}
            {renderMetricRow('Время', formatDuration(totalDuration))}
            {totalBranches && renderFunFact(`Разделил ${totalPlants} кустов на ${totalBranches} веток 🪝`)}
          </>
        );
      }

      case 'hanging': {
        return (
          <>
            {totalBranches && renderMetricRow('Веток развешано', `~${totalBranches}`)}
            {!totalBranches && totalPlants && renderMetricRow('Кустов (ветками)', totalPlants)}
            {renderMetricRow('Время', formatDuration(totalDuration))}
            {totalBranches && renderFunFact(
              totalBranches > 500 ? `~${totalBranches} веток — как новогодняя ёлка на стероидах 🎄` :
              totalBranches > 200 ? `~${totalBranches} веток — хватит на гирлянду через весь дом 🏠` :
              totalBranches > 50 ? `~${totalBranches} веток — целый бельевой день на верёвках 👕` :
              `Развесил ~${totalBranches} веток 🧵`
            )}
          </>
        );
      }

      case 'observer': {
        return (
          <>
            {renderMetricRow('Время наблюдения', formatDuration(totalDuration))}
            {renderFunFact('Моральная поддержка: бесценно 💛')}
          </>
        );
      }

      default:
        return renderMetricRow('Время', formatDuration(totalDuration));
    }
  };

  const content = (
    <div className={embedded ? '' : ''}>
      {/* Шапка */}
      {!embedded && (
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-green-600/20 flex items-center justify-center shrink-0">
            <span className="text-2xl">🎉</span>
          </div>
          <div>
            <h3 className="text-white font-bold text-lg">Сбор завершён!</h3>
            <p className="text-dark-400 text-sm">
              {roomName && <span>{roomName}</span>}
              {strain && <span className="ml-2 text-primary-400">{strain}</span>}
            </p>
          </div>
        </div>
      )}

      {/* Сводка */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="bg-dark-700 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-white">{totalPlants || 0}</div>
          <div className="text-xs text-dark-400">Кустов</div>
        </div>
        <div className="bg-dark-700 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-green-400">{totalWetWeight ? `${(totalWetWeight / 1000).toFixed(1)} кг` : '—'}</div>
          <div className="text-xs text-dark-400">Мокрый вес</div>
        </div>
        <div className="bg-dark-700 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-primary-400">{formatDuration(sessionDurationMs)}</div>
          <div className="text-xs text-dark-400">Длительность</div>
        </div>
        <div className="bg-dark-700 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-yellow-400">{teamSize}</div>
          <div className="text-xs text-dark-400">Человек в команде</div>
        </div>
      </div>

      {/* Карточки по ролям */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Object.entries(roleGroups).map(([role, membersInRole]) =>
          renderRoleCard(role, membersInRole)
        )}
      </div>

      {/* Кнопка закрыть */}
      {onClose && !embedded && (
        <button
          onClick={onClose}
          className="w-full mt-5 px-4 py-3 bg-dark-700 hover:bg-dark-600 text-dark-300 hover:text-white border border-dark-600 rounded-xl font-medium transition"
        >
          Закрыть
        </button>
      )}
    </div>
  );

  if (embedded) {
    return content;
  }

  // Модалка
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-dark-800 border-2 border-green-600 rounded-2xl p-6 max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        {content}
      </div>
    </div>
  );
};

export default CrewInfographic;
