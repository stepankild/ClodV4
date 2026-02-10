import { useState, useMemo } from 'react';
import PlantCell, { STRAIN_COLORS } from './PlantCell';
import RoomMapSetup from './RoomMapSetup';

// Найти сорт по номеру куста
function getStrainForPlant(plantNumber, flowerStrains) {
  if (!flowerStrains || !plantNumber) return null;
  const idx = flowerStrains.findIndex(
    fs => plantNumber >= fs.startNumber && plantNumber <= fs.endNumber
  );
  if (idx === -1) return null;
  return { ...flowerStrains[idx], strainIndex: idx };
}

// Общее количество кустов
function getTotalPlants(flowerStrains) {
  if (!flowerStrains) return 0;
  return flowerStrains.reduce((sum, fs) => sum + (fs.quantity || 0), 0);
}

// Миграция: старый формат (rows + positionsPerRow) → новый (customRows)
function migrateLayout(layout) {
  if (!layout) return { customRows: [], plantPositions: [] };
  // Новый формат уже
  if (layout.customRows && layout.customRows.length > 0) {
    return layout;
  }
  // Старый формат — конвертируем
  if (layout.rows > 0 && layout.positionsPerRow > 0) {
    const customRows = [];
    for (let i = 0; i < layout.rows; i++) {
      customRows.push({ name: `Ряд ${i + 1}`, positions: layout.positionsPerRow });
    }
    return { customRows, plantPositions: layout.plantPositions || [] };
  }
  return { customRows: [], plantPositions: [] };
}

export default function RoomMap({ room, onSave, saving }) {
  const layout = migrateLayout(room.roomLayout);
  const flowerStrains = room.flowerStrains || [];
  const totalPlants = getTotalPlants(flowerStrains);

  const [customRows, setCustomRows] = useState(layout.customRows || []);
  const [plantPositions, setPlantPositions] = useState(layout.plantPositions || []);
  const [editMode, setEditMode] = useState(false);
  const [showSetup, setShowSetup] = useState(customRows.length === 0);

  // Для назначения ряда целиком
  const [assignRowIdx, setAssignRowIdx] = useState(null);

  // Для назначения отдельной ячейки
  const [assignCell, setAssignCell] = useState(null); // { row, position }

  // Быстрая карта: row:position → plantNumber
  const positionMap = useMemo(() => {
    const m = {};
    plantPositions.forEach(p => {
      m[`${p.row}:${p.position}`] = p.plantNumber;
    });
    return m;
  }, [plantPositions]);

  // Какие кусты уже размещены
  const placedPlants = useMemo(() => {
    return new Set(plantPositions.map(p => p.plantNumber));
  }, [plantPositions]);

  // Неразмещённые кусты
  const unplacedPlants = useMemo(() => {
    const result = [];
    flowerStrains.forEach(fs => {
      if (!fs.startNumber || !fs.endNumber) return;
      for (let n = fs.startNumber; n <= fs.endNumber; n++) {
        if (!placedPlants.has(n)) result.push(n);
      }
    });
    return result;
  }, [flowerStrains, placedPlants]);

  // Макс кол-во позиций (для выравнивания столбцов по высоте)
  const maxPositions = useMemo(() => {
    return Math.max(...customRows.map(r => r.positions || 0), 0);
  }, [customRows]);

  // Сводка по рядам
  const rowSummaries = useMemo(() => {
    return customRows.map((_, rowIdx) => {
      const plantsInRow = plantPositions.filter(p => p.row === rowIdx);
      const byStrain = {};
      plantsInRow.forEach(p => {
        const s = getStrainForPlant(p.plantNumber, flowerStrains);
        const name = s ? s.strain : '?';
        byStrain[name] = (byStrain[name] || 0) + 1;
      });
      return { count: plantsInRow.length, byStrain };
    });
  }, [customRows, plantPositions, flowerStrains]);

  const handleApplySetup = (newCustomRows) => {
    // Очистить позиции которые выходят за пределы новых рядов
    const cleaned = plantPositions.filter(p => {
      if (p.row >= newCustomRows.length) return false;
      if (p.position >= newCustomRows[p.row].positions) return false;
      return true;
    });
    setCustomRows(newCustomRows);
    setPlantPositions(cleaned);
    setShowSetup(false);
  };

  // Авто-заполнение: сверху вниз, слева направо (т.к. вертикальное отображение)
  const handleAutoFill = () => {
    const newPositions = [];
    let plantIdx = 0;
    const allPlants = [];
    flowerStrains.forEach(fs => {
      if (!fs.startNumber || !fs.endNumber) return;
      for (let n = fs.startNumber; n <= fs.endNumber; n++) {
        allPlants.push(n);
      }
    });

    for (let r = 0; r < customRows.length && plantIdx < allPlants.length; r++) {
      for (let p = 0; p < customRows[r].positions && plantIdx < allPlants.length; p++) {
        newPositions.push({ row: r, position: p, plantNumber: allPlants[plantIdx] });
        plantIdx++;
      }
    }
    setPlantPositions(newPositions);
  };

  // Очистить все позиции
  const handleClearAll = () => {
    setPlantPositions([]);
    setAssignRowIdx(null);
    setAssignCell(null);
  };

  // Очистить один ряд
  const handleClearRow = (rowIdx) => {
    setPlantPositions(prev => prev.filter(p => p.row !== rowIdx));
  };

  // Назначить ряд целиком одним сортом
  const handleAssignRow = (rowIdx, strainIdx) => {
    const fs = flowerStrains[strainIdx];
    if (!fs || !fs.startNumber) return;

    const cleaned = plantPositions.filter(p => p.row !== rowIdx);
    const usedInOtherRows = new Set(cleaned.map(p => p.plantNumber));
    const available = [];
    for (let n = fs.startNumber; n <= fs.endNumber; n++) {
      if (!usedInOtherRows.has(n)) available.push(n);
    }

    const rowPositions = customRows[rowIdx]?.positions || 0;
    const newPositions = [...cleaned];
    for (let p = 0; p < rowPositions && p < available.length; p++) {
      newPositions.push({ row: rowIdx, position: p, plantNumber: available[p] });
    }

    setPlantPositions(newPositions);
    setAssignRowIdx(null);
  };

  // Назначить отдельную ячейку конкретным кустом
  const handleAssignCell = (row, position, plantNumber) => {
    let cleaned = plantPositions.filter(p => !(p.row === row && p.position === position));
    cleaned = cleaned.filter(p => p.plantNumber !== plantNumber);
    cleaned.push({ row, position, plantNumber });
    setPlantPositions(cleaned);
    setAssignCell(null);
  };

  // Клик по ячейке
  const handleCellClick = (row, position) => {
    if (!editMode) return;
    const existing = positionMap[`${row}:${position}`];
    if (existing) {
      setPlantPositions(prev => prev.filter(p => !(p.row === row && p.position === position)));
    } else {
      setAssignCell({ row, position });
      setAssignRowIdx(null);
    }
  };

  // Сохранить
  const handleSave = () => {
    onSave({
      customRows,
      plantPositions
    });
    setEditMode(false);
  };

  const hasGrid = customRows.length > 0;

  // Настройка сетки
  if (showSetup || !hasGrid) {
    return (
      <div className="space-y-4">
        <RoomMapSetup
          currentRows={customRows.length > 0 ? customRows : null}
          plantsCount={totalPlants}
          onApply={handleApplySetup}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Заголовок + кнопки */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-medium text-white">
          Карта комнаты
          <span className="text-dark-400 font-normal ml-2">
            {customRows.length} рядов
          </span>
        </h4>
        <div className="flex gap-2 flex-wrap">
          {editMode ? (
            <>
              <button
                type="button"
                onClick={handleAutoFill}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition"
                title="Разместить всех кустов автоматически"
              >
                Авто
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="px-2 py-1 text-xs bg-dark-700 text-red-400 rounded hover:bg-dark-600 transition"
              >
                Очистить
              </button>
              <button
                type="button"
                onClick={() => setShowSetup(true)}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition"
              >
                Ряды
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-500 disabled:opacity-50 transition"
              >
                {saving ? '...' : 'Сохранить'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditMode(false);
                  const restored = migrateLayout(room.roomLayout);
                  setCustomRows(restored.customRows || []);
                  setPlantPositions(restored.plantPositions || []);
                  setAssignRowIdx(null);
                  setAssignCell(null);
                }}
                className="px-3 py-1 text-xs text-dark-400 hover:bg-dark-700 rounded transition"
              >
                Отмена
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className="px-3 py-1 text-xs bg-dark-700 text-white rounded hover:bg-dark-600 transition"
              >
                Редактировать
              </button>
              <button
                type="button"
                onClick={() => setShowSetup(true)}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition"
              >
                Ряды
              </button>
            </>
          )}
        </div>
      </div>

      {/* Вертикальная карта: ряды как столбцы */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {customRows.map((row, rowIdx) => (
          <div key={rowIdx} className="flex flex-col items-center gap-1 shrink-0">
            {/* Заголовок ряда */}
            <div className="flex items-center gap-1 mb-1">
              <span className="text-xs text-dark-400 font-medium whitespace-nowrap">
                {row.name || `Ряд ${rowIdx + 1}`}
              </span>
              {editMode && (
                <button
                  type="button"
                  onClick={() => {
                    setAssignRowIdx(assignRowIdx === rowIdx ? null : rowIdx);
                    setAssignCell(null);
                  }}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition ${
                    assignRowIdx === rowIdx
                      ? 'bg-primary-600 text-white'
                      : 'text-dark-500 hover:text-dark-300 hover:bg-dark-700'
                  }`}
                  title="Назначить ряд сортом"
                >
                  &#9998;
                </button>
              )}
            </div>

            {/* Ячейки вертикально */}
            <div className="flex flex-col gap-1">
              {Array.from({ length: row.positions }, (_, posIdx) => {
                const plantNumber = positionMap[`${rowIdx}:${posIdx}`];
                const strain = plantNumber ? getStrainForPlant(plantNumber, flowerStrains) : null;
                return (
                  <PlantCell
                    key={posIdx}
                    plantNumber={plantNumber}
                    strainIndex={strain?.strainIndex}
                    strainName={strain?.strain}
                    isEmpty={!plantNumber}
                    isSelected={
                      assignCell?.row === rowIdx && assignCell?.position === posIdx
                    }
                    onClick={() => handleCellClick(rowIdx, posIdx)}
                    compact={customRows.length > 8}
                  />
                );
              })}
            </div>

            {/* Счётчик под рядом */}
            {!editMode && rowSummaries[rowIdx]?.count > 0 && (
              <span className="text-[10px] text-dark-500 mt-1">
                {rowSummaries[rowIdx].count}шт
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Панель назначения ряда */}
      {editMode && assignRowIdx !== null && (
        <div className="bg-dark-700/50 border border-dark-600 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-dark-300">
              Назначить «{customRows[assignRowIdx]?.name || `Ряд ${assignRowIdx + 1}`}» сортом:
            </span>
            <button
              type="button"
              onClick={() => handleClearRow(assignRowIdx)}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Очистить ряд
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {flowerStrains.map((fs, idx) => {
              const color = STRAIN_COLORS[idx % STRAIN_COLORS.length];
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleAssignRow(assignRowIdx, idx)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition hover:brightness-125 ${color.bg} ${color.border} ${color.text}`}
                >
                  {fs.strain || `Сорт ${idx + 1}`} ({fs.quantity})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Панель назначения ячейки */}
      {editMode && assignCell && (
        <div className="bg-dark-700/50 border border-dark-600 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-dark-300">
              {customRows[assignCell.row]?.name || `Ряд ${assignCell.row + 1}`}, позиция {assignCell.position + 1}
            </span>
            <button
              type="button"
              onClick={() => setAssignCell(null)}
              className="text-xs text-dark-500 hover:text-dark-300"
            >
              Закрыть
            </button>
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {flowerStrains.map((fs, strIdx) => {
              const color = STRAIN_COLORS[strIdx % STRAIN_COLORS.length];
              const unplaced = [];
              if (fs.startNumber && fs.endNumber) {
                for (let n = fs.startNumber; n <= fs.endNumber; n++) {
                  if (!placedPlants.has(n)) unplaced.push(n);
                }
              }
              if (unplaced.length === 0) return null;
              return (
                <div key={strIdx}>
                  <div className={`text-xs font-medium mb-1 ${color.text}`}>{fs.strain || `Сорт ${strIdx + 1}`}</div>
                  <div className="flex flex-wrap gap-1">
                    {unplaced.map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => handleAssignCell(assignCell.row, assignCell.position, n)}
                        className={`w-8 h-8 text-xs rounded border ${color.bg} ${color.border} ${color.text} hover:brightness-125 transition`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Легенда сортов */}
      {flowerStrains.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs">
          {flowerStrains.map((fs, idx) => {
            const color = STRAIN_COLORS[idx % STRAIN_COLORS.length];
            const placed = plantPositions.filter(p => {
              const s = getStrainForPlant(p.plantNumber, flowerStrains);
              return s?.strainIndex === idx;
            }).length;
            return (
              <div key={idx} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                <span className="text-dark-300">{fs.strain || `Сорт ${idx + 1}`}</span>
                <span className="text-dark-500">{placed}/{fs.quantity}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Неразмещённые */}
      {unplacedPlants.length > 0 && (
        <div className="text-xs text-dark-500">
          Не размещено: <span className="text-amber-400">{unplacedPlants.length}</span> из {totalPlants} кустов
        </div>
      )}

      {/* Сводка по рядам (режим просмотра) */}
      {!editMode && plantPositions.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-dark-500 mb-1">По рядам:</div>
          {rowSummaries.map((summary, idx) => {
            if (summary.count === 0) return null;
            const rowName = customRows[idx]?.name || `Ряд ${idx + 1}`;
            const parts = Object.entries(summary.byStrain)
              .map(([name, count]) => `${name}: ${count}`)
              .join(', ');
            return (
              <div key={idx} className="text-xs text-dark-400">
                <span className="text-dark-500">{rowName}:</span>{' '}
                <span className="text-dark-300">{summary.count} кустов</span>
                {parts && <span className="text-dark-500 ml-1">({parts})</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
