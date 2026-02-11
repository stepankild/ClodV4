import { STRAIN_COLORS } from './PlantCell';

function getStrainIndex(plantNumber, flowerStrains) {
  if (!flowerStrains || !plantNumber) return -1;
  return flowerStrains.findIndex(
    fs => plantNumber >= fs.startNumber && plantNumber <= fs.endNumber
  );
}

/**
 * Read-only карта комнаты для страницы сбора урожая.
 * Показывает три состояния: собран (зелёный), не собран (цветной, кликабельный), пусто (серый).
 */
export default function HarvestRoomMap({ room, harvestedPlants, harvestedWeights, onPlantClick }) {
  const layout = room?.roomLayout;
  if (!layout?.customRows?.length) return null;

  const customRows = layout.customRows;
  const flowerStrains = room.flowerStrains || [];

  // Карта позиций: "row:position" → plantNumber
  const posMap = {};
  (layout.plantPositions || []).forEach(p => {
    posMap[`${p.row}:${p.position}`] = p.plantNumber;
  });

  const hasPlants = (layout.plantPositions || []).length > 0;
  if (!hasPlants) return null;

  // Считаем статистику по сортам
  const strainStats = flowerStrains.map((fs, idx) => {
    const allNumbers = [];
    if (fs.startNumber && fs.endNumber) {
      for (let n = fs.startNumber; n <= fs.endNumber; n++) allNumbers.push(n);
    }
    const placed = allNumbers.filter(n =>
      (layout.plantPositions || []).some(p => p.plantNumber === n)
    );
    const harvested = placed.filter(n => harvestedPlants.has(n));
    return {
      strain: fs.strain || `Сорт ${idx + 1}`,
      color: STRAIN_COLORS[idx % STRAIN_COLORS.length],
      total: placed.length,
      harvested: harvested.length,
    };
  });

  const totalPlaced = (layout.plantPositions || []).length;
  const totalHarvested = harvestedPlants.size;

  return (
    <div className="space-y-3">
      {/* Карта: ряды горизонтально */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {customRows.map((row, rowIdx) => {
          const cols = row.cols || 1;
          const rowsCount = row.rows || 1;

          return (
            <div key={rowIdx} className="flex flex-col items-center shrink-0">
              {/* Название ряда */}
              <span className="text-xs text-dark-400 font-medium whitespace-nowrap mb-1">
                {row.name || `Ряд ${rowIdx + 1}`}
              </span>

              {/* Сетка */}
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: rowsCount }, (_, rIdx) =>
                  Array.from({ length: cols }, (_, cIdx) => {
                    const posIdx = rIdx * cols + cIdx;
                    const plantNumber = posMap[`${rowIdx}:${posIdx}`];
                    const strainIdx = plantNumber ? getStrainIndex(plantNumber, flowerStrains) : -1;
                    const isHarvested = plantNumber ? harvestedPlants.has(plantNumber) : false;
                    const weight = plantNumber && harvestedWeights ? harvestedWeights.get(plantNumber) : null;

                    // Пустая ячейка
                    if (!plantNumber) {
                      return (
                        <div
                          key={posIdx}
                          className="min-w-[36px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px] border border-dashed border-dark-600 rounded-md flex items-center justify-center"
                        >
                          <span className="text-dark-600 text-[9px] select-none">—</span>
                        </div>
                      );
                    }

                    // Собранный куст
                    if (isHarvested) {
                      return (
                        <div
                          key={posIdx}
                          className="min-w-[36px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px] bg-green-500/25 border border-green-500/60 rounded-md flex flex-col items-center justify-center gap-0 transition"
                          title={`#${plantNumber} — собран${weight != null ? ` (${weight} г)` : ''}`}
                        >
                          <span className="text-[10px] font-bold text-green-400 leading-tight flex items-center gap-0.5">
                            <span className="text-green-500 text-[8px]">✓</span>
                            {plantNumber}
                          </span>
                          {weight != null && (
                            <span className="text-[8px] text-green-500/70 leading-tight">
                              {weight}г
                            </span>
                          )}
                        </div>
                      );
                    }

                    // Несобранный куст — кликабельный
                    const color = strainIdx >= 0
                      ? STRAIN_COLORS[strainIdx % STRAIN_COLORS.length]
                      : STRAIN_COLORS[0];

                    return (
                      <button
                        key={posIdx}
                        type="button"
                        onClick={() => onPlantClick && onPlantClick(plantNumber)}
                        title={`#${plantNumber} — нажмите чтобы записать`}
                        className={`
                          min-w-[36px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px]
                          ${color.bg} border ${color.border} rounded-md
                          flex flex-col items-center justify-center gap-0
                          transition cursor-pointer
                          hover:brightness-125 hover:scale-105
                        `}
                      >
                        <span className={`text-xs font-bold ${color.text} leading-tight`}>
                          {plantNumber}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Легенда по сортам */}
      {strainStats.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {strainStats.map((st, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${st.color.dot}`} />
              <span className="text-dark-300">{st.strain}</span>
              <span className="text-dark-500">
                {st.harvested}/{st.total}
              </span>
              {st.harvested === st.total && st.total > 0 && (
                <span className="text-green-500 text-[10px]">✓</span>
              )}
            </div>
          ))}
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-dark-400">Всего:</span>
            <span className="text-white font-medium">{totalHarvested}/{totalPlaced}</span>
          </div>
        </div>
      )}
    </div>
  );
}
