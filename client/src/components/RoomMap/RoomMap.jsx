import { useState, useMemo, useCallback } from 'react';
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

function getRowPositions(row) {
  return (row.cols || 1) * (row.rows || 1);
}

function migrateLayout(layout) {
  if (!layout) return { customRows: [], plantPositions: [], fillDirection: 'topDown' };
  if (layout.customRows && layout.customRows.length > 0) {
    const migrated = layout.customRows.map(r => {
      if (r.cols) return r;
      return { name: r.name || '', cols: r.positions || 4, rows: 1 };
    });
    return { customRows: migrated, plantPositions: layout.plantPositions || [], fillDirection: layout.fillDirection || 'topDown' };
  }
  if (layout.rows > 0 && layout.positionsPerRow > 0) {
    const customRows = [];
    for (let i = 0; i < layout.rows; i++) {
      customRows.push({ name: `Ряд ${i + 1}`, cols: layout.positionsPerRow, rows: 1 });
    }
    return { customRows, plantPositions: layout.plantPositions || [], fillDirection: 'topDown' };
  }
  return { customRows: [], plantPositions: [], fillDirection: 'topDown' };
}

// PDF export
async function exportToPDF(room, customRows, plantPositions, flowerStrains) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;

  // Заголовок
  doc.setFontSize(16);
  doc.setTextColor(30, 30, 30);
  doc.text(`${room.name || 'Комната'} — Карта`, margin, margin + 6);

  // Подзаголовок: цикл
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  const cycleName = room.cycleName || '';
  const dateStr = new Date().toLocaleDateString('ru-RU');
  doc.text(`${cycleName ? cycleName + ' | ' : ''}${dateStr}`, margin, margin + 12);

  // Легенда сортов
  let legendY = margin + 18;
  doc.setFontSize(8);
  flowerStrains.forEach((fs, idx) => {
    const color = STRAIN_COLORS[idx % STRAIN_COLORS.length];
    const [r, g, b] = hexToRgb(color.hex);
    doc.setFillColor(r, g, b);
    doc.circle(margin + 2, legendY + 1.5, 1.5, 'F');
    doc.setTextColor(60, 60, 60);
    const placed = plantPositions.filter(p => {
      const s = getStrainForPlant(p.plantNumber, flowerStrains);
      return s?.strainIndex === idx;
    }).length;
    doc.text(`${fs.strain || 'Сорт ' + (idx + 1)} (${placed}/${fs.quantity})`, margin + 6, legendY + 2.5);
    legendY += 5;
  });

  // Построить карту позиций
  const posMap = {};
  plantPositions.forEach(p => { posMap[`${p.row}:${p.position}`] = p.plantNumber; });

  // Размеры ячеек
  const cellSize = 10;
  const cellGap = 1.5;
  const rowGap = 6;
  const startY = legendY + 6;

  let curX = margin;

  customRows.forEach((row, rowIdx) => {
    const cols = row.cols || 1;
    const rowsCount = row.rows || 1;
    const blockW = cols * (cellSize + cellGap) - cellGap;

    // Проверяем место, делаем новую страницу если нужно
    if (curX + blockW + margin > pageW) {
      doc.addPage();
      curX = margin;
    }

    // Имя ряда
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(row.name || `Ряд ${rowIdx + 1}`, curX, startY - 2);

    // Ячейки
    for (let rIdx = 0; rIdx < rowsCount; rIdx++) {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const posIdx = rIdx * cols + cIdx;
        const plantNumber = posMap[`${rowIdx}:${posIdx}`];
        const x = curX + cIdx * (cellSize + cellGap);
        const y = startY + rIdx * (cellSize + cellGap);

        if (plantNumber) {
          const strain = getStrainForPlant(plantNumber, flowerStrains);
          const colorIdx = strain?.strainIndex || 0;
          const color = STRAIN_COLORS[colorIdx % STRAIN_COLORS.length];
          const [r, g, b] = hexToRgb(color.hex);

          // Цветной фон
          doc.setFillColor(r, g, b, 0.25);
          doc.setDrawColor(r, g, b);
          doc.setLineWidth(0.4);
          doc.roundedRect(x, y, cellSize, cellSize, 1, 1, 'FD');

          // Номер куста
          doc.setFontSize(7);
          doc.setTextColor(r, g, b);
          doc.text(String(plantNumber), x + cellSize / 2, y + cellSize / 2 + 1, { align: 'center' });

          // Имя сорта маленькое
          if (strain?.strain) {
            doc.setFontSize(4);
            doc.setTextColor(130, 130, 130);
            const shortName = strain.strain.length > 6 ? strain.strain.slice(0, 6) : strain.strain;
            doc.text(shortName, x + cellSize / 2, y + cellSize - 1.5, { align: 'center' });
          }
        } else {
          // Пустая ячейка
          doc.setFillColor(245, 245, 245);
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.2);
          doc.roundedRect(x, y, cellSize, cellSize, 1, 1, 'FD');
          doc.setFontSize(6);
          doc.setTextColor(180, 180, 180);
          doc.text('—', x + cellSize / 2, y + cellSize / 2 + 1, { align: 'center' });
        }
      }
    }

    curX += blockW + rowGap;
  });

  // Итого
  const totalPlaced = plantPositions.length;
  const totalSpots = customRows.reduce((s, r) => s + getRowPositions(r), 0);
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  const footY = pageH - margin;
  doc.text(`Размещено: ${totalPlaced} из ${getTotalPlants(flowerStrains)} кустов | Всего мест: ${totalSpots}`, margin, footY);

  doc.save(`${room.name || 'room'}-map-${dateStr}.pdf`);
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

export default function RoomMap({ room, onSave, saving }) {
  const layout = migrateLayout(room.roomLayout);
  const flowerStrains = room.flowerStrains || [];
  const totalPlants = getTotalPlants(flowerStrains);

  const [customRows, setCustomRows] = useState(layout.customRows || []);
  const [plantPositions, setPlantPositions] = useState(layout.plantPositions || []);
  const [fillDirection, setFillDirection] = useState(layout.fillDirection || 'topDown');
  const [editMode, setEditMode] = useState(false);
  const [showSetup, setShowSetup] = useState(customRows.length === 0);
  const [assignRowIdx, setAssignRowIdx] = useState(null);
  const [assignCell, setAssignCell] = useState(null);
  const [exporting, setExporting] = useState(false);

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

  // Авто-заполнение с учётом направления
  const handleAutoFill = () => {
    const newPositions = [];
    let plantIdx = 0;
    const allPlants = [];
    flowerStrains.forEach(fs => {
      if (!fs.startNumber || !fs.endNumber) return;
      for (let n = fs.startNumber; n <= fs.endNumber; n++) allPlants.push(n);
    });

    const rowOrder = fillDirection === 'bottomUp'
      ? [...Array(customRows.length).keys()].reverse()
      : [...Array(customRows.length).keys()];

    for (const r of rowOrder) {
      if (plantIdx >= allPlants.length) break;
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
    onSave({ customRows, plantPositions, fillDirection });
    setEditMode(false);
  };

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      await exportToPDF(room, customRows, plantPositions, flowerStrains);
    } catch (e) {
      console.error('PDF export error:', e);
    } finally {
      setExporting(false);
    }
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

  // Порядок рядов для отрисовки (визуально)
  const displayRowOrder = fillDirection === 'bottomUp'
    ? [...Array(customRows.length).keys()].reverse()
    : [...Array(customRows.length).keys()];

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

              {/* Направление нумерации */}
              <button type="button"
                onClick={() => setFillDirection(d => d === 'topDown' ? 'bottomUp' : 'topDown')}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition"
                title={fillDirection === 'topDown' ? 'Сверху вниз' : 'Снизу вверх'}>
                {fillDirection === 'topDown' ? '↓' : '↑'}
              </button>

              <button type="button" onClick={handleSave} disabled={saving}
                className="px-3 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-500 disabled:opacity-50 transition">
                {saving ? '...' : 'Сохранить'}</button>
              <button type="button" onClick={() => {
                  setEditMode(false);
                  const restored = migrateLayout(room.roomLayout);
                  setCustomRows(restored.customRows || []);
                  setPlantPositions(restored.plantPositions || []);
                  setFillDirection(restored.fillDirection || 'topDown');
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
              <button type="button" onClick={handleExportPDF} disabled={exporting}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition disabled:opacity-50"
                title="Скачать PDF для печати">
                {exporting ? '...' : 'PDF'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Направление заполнения (инфо) */}
      {editMode && (
        <div className="text-[10px] text-dark-500">
          Нумерация: {fillDirection === 'topDown' ? 'сверху вниз ↓' : 'снизу вверх ↑'}
        </div>
      )}

      {/* Карта: каждый ряд — столбец, внутри cols × rows сетка */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {displayRowOrder.map(rowIdx => {
          const row = customRows[rowIdx];
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

              {/* Размер */}
              <div className="text-[10px] text-dark-600 mb-1">{cols}×{rowsCount}</div>

              {/* Мини-сетка */}
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
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
              {!editMode && (
                <span className="text-[10px] text-dark-500 mt-1">
                  {rowSummaries[rowIdx]?.count || 0}/{cols * rowsCount}
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
