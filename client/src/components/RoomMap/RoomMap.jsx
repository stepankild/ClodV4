import { useState, useMemo } from 'react';
import PlantCell, { STRAIN_COLORS } from './PlantCell';
import RoomMapSetup from './RoomMapSetup';

function getStrainForPlant(plantNumber, flowerStrains) {
  if (!flowerStrains || !plantNumber) return null;
  const idx = flowerStrains.findIndex(
    fs => plantNumber >= fs.startNumber && plantNumber <= fs.endNumber
  );
  if (idx === -1) return null;
  return { ...flowerStrains[idx], strainIndex: idx };
}

function getTotalPlants(flowerStrains) {
  if (!flowerStrains) return 0;
  return flowerStrains.reduce((sum, fs) => sum + (fs.quantity || 0), 0);
}

// Количество мест в ряду
function getRowPositions(row) {
  return (row.cols || 1) * (row.rows || 1);
}

// Миграция старых форматов
function migrateLayout(layout) {
  if (!layout) return { customRows: [], plantPositions: [] };
  if (layout.customRows && layout.customRows.length > 0) {
    // Миграция positions → cols/rows если нужно
    const migrated = layout.customRows.map(r => {
      if (r.cols) return r;
      // Старый формат с positions
      return { name: r.name || '', cols: r.positions || 4, rows: 1 };
    });
    return { customRows: migrated, plantPositions: layout.plantPositions || [] };
  }
  if (layout.rows > 0 && layout.positionsPerRow > 0) {
    const customRows = [];
    for (let i = 0; i < layout.rows; i++) {
      customRows.push({ name: `Ряд ${i + 1}`, cols: layout.positionsPerRow, rows: 1 });
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
  const [assignRowIdx, setAssignRowIdx] = useState(null);
  const [assignCell, setAssignCell] = useState(null);

  const positionMap = useMemo(() => {
    const m = {};
    plantPositions.forEach(p => { m[`${p.row}:${p.position}`] = p.plantNumber; });
    return m;
  }, [plantPositions]);

  const placedPlants = useMemo(() => {
    return new Set(plantPositions.map(p => p.plantNumber));
  }, [plantPositions]);

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
    const cleaned = plantPositions.filter(p => {
      if (p.row >= newCustomRows.length) return false;
      if (p.position >= getRowPositions(newCustomRows[p.row])) return false;
      return true;
    });
    setCustomRows(newCustomRows);
    setPlantPositions(cleaned);
    setShowSetup(false);
  };

  const handleAutoFill = () => {
    const newPositions = [];
    let plantIdx = 0;
    const allPlants = [];
    flowerStrains.forEach(fs => {
      if (!fs.startNumber || !fs.endNumber) return;
      for (let n = fs.startNumber; n <= fs.endNumber; n++) allPlants.push(n);
    });

    for (let r = 0; r < customRows.length && plantIdx < allPlants.length; r++) {
      const total = getRowPositions(customRows[r]);
      for (let p = 0; p < total && plantIdx < allPlants.length; p++) {
        newPositions.push({ row: r, position: p, plantNumber: allPlants[plantIdx] });
        plantIdx++;
      }
    }
    setPlantPositions(newPositions);
  };

  const handleClearAll = () => {
    setPlantPositions([]);
    setAssignRowIdx(null);
    setAssignCell(null);
  };

  const handleClearRow = (rowIdx) => {
    setPlantPositions(prev => prev.filter(p => p.row !== rowIdx));
  };

  const handleAssignRow = (rowIdx, strainIdx) => {
    const fs = flowerStrains[strainIdx];
    if (!fs || !fs.startNumber) return;

    const cleaned = plantPositions.filter(p => p.row !== rowIdx);
    const usedInOtherRows = new Set(cleaned.map(p => p.plantNumber));
    const available = [];
    for (let n = fs.startNumber; n <= fs.endNumber; n++) {
      if (!usedInOtherRows.has(n)) available.push(n);
    }

    const total = getRowPositions(customRows[rowIdx]);
    const newPositions = [...cleaned];
    for (let p = 0; p < total && p < available.length; p++) {
      newPositions.push({ row: rowIdx, position: p, plantNumber: available[p] });
    }

    setPlantPositions(newPositions);
    setAssignRowIdx(null);
  };

  const handleAssignCell = (row, position, plantNumber) => {
    let cleaned = plantPositions.filter(p => !(p.row === row && p.position === position));
    cleaned = cleaned.filter(p => p.plantNumber !== plantNumber);
    cleaned.push({ row, position, plantNumber });
    setPlantPositions(cleaned);
    setAssignCell(null);
  };

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

  const handleSave = () => {
    onSave({ customRows, plantPositions });
    setEditMode(false);
  };

  const hasGrid = customRows.length > 0;

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
          <span className="text-dark-400 font-normal ml-2">{customRows.length} рядов</span>
        </h4>
        <div className="flex gap-2 flex-wrap">
          {editMode ? (
            <>
              <button type="button" onClick={handleAutoFill}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition"
                title="Разместить всех кустов автоматически">Авто</button>
              <button type="button" onClick={handleClearAll}
                className="px-2 py-1 text-xs bg-dark-700 text-red-400 rounded hover:bg-dark-600 transition">Очистить</button>
              <button type="button" onClick={() => setShowSetup(true)}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition">Ряды</button>
              <button type="button" onClick={handleSave} disabled={saving}
                className="px-3 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-500 disabled:opacity-50 transition">
                {saving ? '...' : 'Сохранить'}</button>
              <button type="button" onClick={() => {
                  setEditMode(false);
                  const restored = migrateLayout(room.roomLayout);
                  setCustomRows(restored.customRows || []);
                  setPlantPositions(restored.plantPositions || []);
                  setAssignRowIdx(null);
                  setAssignCell(null);
                }}
                className="px-3 py-1 text-xs text-dark-400 hover:bg-dark-700 rounded transition">Отмена</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setEditMode(true)}
                className="px-3 py-1 text-xs bg-dark-700 text-white rounded hover:bg-dark-600 transition">Редактировать</button>
              <button type="button" onClick={() => setShowSetup(true)}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition">Ряды</button>
            </>
          )}
        </div>
      </div>

      {/* Карта: каждый ряд — столбец, внутри cols × rows сетка */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {customRows.map((row, rowIdx) => {
          const cols = row.cols || 1;
          const rowsCount = row.rows || 1;
          return (
            <div key={rowIdx} className="flex flex-col items-center shrink-0">
              {/* Заголовок ряда */}
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-xs text-dark-400 font-medium whitespace-nowrap">
                  {row.name || `Ряд ${rowIdx + 1}`}
                </span>
                {editMode && (
                  <button type="button"
                    onClick={() => {
                      setAssignRowIdx(assignRowIdx === rowIdx ? null : rowIdx);
                      setAssignCell(null);
                    }}
                    className={`text-[10px] px-1.5 py-0.5 rounded transition ${
                      assignRowIdx === rowIdx
                        ? 'bg-primary-600 text-white'
                        : 'text-dark-500 hover:text-dark-300 hover:bg-dark-700'
                    }`}
                    title="Назначить ряд сортом">&#9998;</button>
                )}
              </div>

              {/* Размер ряда */}
              <div className="text-[10px] text-dark-600 mb-1">{cols}×{rowsCount}</div>

              {/* Мини-сетка cols × rows */}
              <div
                className="grid gap-1"
                style={{
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`
                }}
              >
                {Array.from({ length: rowsCount }, (_, rIdx) =>
                  Array.from({ length: cols }, (_, cIdx) => {
                    const posIdx = rIdx * cols + cIdx;
                    const plantNumber = positionMap[`${rowIdx}:${posIdx}`];
                    const strain = plantNumber ? getStrainForPlant(plantNumber, flowerStrains) : null;
                    return (
                      <PlantCell
                        key={posIdx}
                        plantNumber={plantNumber}
                        strainIndex={strain?.strainIndex}
                        strainName={strain?.strain}
                        isEmpty={!plantNumber}
                        isSelected={assignCell?.row === rowIdx && assignCell?.position === posIdx}
                        onClick={() => handleCellClick(rowIdx, posIdx)}
                        compact={cols > 6}
                      />
                    );
                  })
                )}
              </div>

              {/* Счётчик */}
              {!editMode && rowSummaries[rowIdx]?.count > 0 && (
                <span className="text-[10px] text-dark-500 mt-1">
                  {rowSummaries[rowIdx].count}/{cols * rowsCount}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Панель назначения ряда */}
      {editMode && assignRowIdx !== null && (
        <div className="bg-dark-700/50 border border-dark-600 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-dark-300">
              Назначить «{customRows[assignRowIdx]?.name || `Ряд ${assignRowIdx + 1}`}» сортом:
            </span>
            <button type="button" onClick={() => handleClearRow(assignRowIdx)}
              className="text-xs text-red-400 hover:text-red-300">Очистить ряд</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {flowerStrains.map((fs, idx) => {
              const color = STRAIN_COLORS[idx % STRAIN_COLORS.length];
              return (
                <button key={idx} type="button"
                  onClick={() => handleAssignRow(assignRowIdx, idx)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition hover:brightness-125 ${color.bg} ${color.border} ${color.text}`}>
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
            <button type="button" onClick={() => setAssignCell(null)}
              className="text-xs text-dark-500 hover:text-dark-300">Закрыть</button>
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
                      <button key={n} type="button"
                        onClick={() => handleAssignCell(assignCell.row, assignCell.position, n)}
                        className={`w-8 h-8 text-xs rounded border ${color.bg} ${color.border} ${color.text} hover:brightness-125 transition`}>
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

      {/* Сводка по рядам */}
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
