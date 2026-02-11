/**
 * Тепловая карта сбора урожая для архива.
 * Цвет ячейки зависит от сырого веса: зелёный = тяжёлый, красный = лёгкий.
 */
export default function ArchiveHeatMap({ harvestMapData }) {
  const { customRows = [], plants = [] } = harvestMapData || {};

  if (!customRows.length || !plants.length) return null;

  // Карта позиций: "row:position" → plant data
  const posMap = {};
  plants.forEach(p => {
    posMap[`${p.row}:${p.position}`] = p;
  });

  // Веса только записанных кустов (wetWeight > 0)
  const weights = plants.filter(p => p.wetWeight > 0).map(p => p.wetWeight);
  const minWeight = weights.length ? Math.min(...weights) : 0;
  const maxWeight = weights.length ? Math.max(...weights) : 0;
  const avgWeight = weights.length ? Math.round(weights.reduce((s, w) => s + w, 0) / weights.length) : 0;
  const range = maxWeight - minWeight;

  // HSL цвет: hue 0 (красный) → 60 (жёлтый) → 120 (зелёный)
  function getHeatColor(weight) {
    if (!weight || range === 0) {
      // Все одинаковые — зелёный
      return { bg: 'hsl(120, 70%, 22%)', border: 'hsl(120, 70%, 35%)', text: 'hsl(120, 70%, 75%)' };
    }
    const ratio = (weight - minWeight) / range;
    const hue = Math.round(ratio * 120);
    return {
      bg: `hsl(${hue}, 70%, 22%)`,
      border: `hsl(${hue}, 70%, 35%)`,
      text: `hsl(${hue}, 70%, 75%)`
    };
  }

  return (
    <div className="space-y-4">
      {/* Карта: ряды горизонтально */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {customRows.map((row, rowIdx) => {
          const cols = row.cols || 1;
          const rowsCount = row.rows || 1;

          return (
            <div key={rowIdx} className="flex flex-col items-center shrink-0">
              <span className="text-xs text-dark-400 font-medium whitespace-nowrap mb-1">
                {row.name || `Ряд ${rowIdx + 1}`}
              </span>

              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: rowsCount }, (_, rIdx) =>
                  Array.from({ length: cols }, (_, cIdx) => {
                    const posIdx = rIdx * cols + cIdx;
                    const plant = posMap[`${rowIdx}:${posIdx}`];

                    // Пустая ячейка
                    if (!plant) {
                      return (
                        <div
                          key={posIdx}
                          className="min-w-[40px] min-h-[40px] sm:min-w-[48px] sm:min-h-[48px] border border-dashed border-dark-600 rounded-md flex items-center justify-center"
                        >
                          <span className="text-dark-600 text-[9px]">—</span>
                        </div>
                      );
                    }

                    // Куст без веса (не собран)
                    if (!plant.wetWeight) {
                      return (
                        <div
                          key={posIdx}
                          className="min-w-[40px] min-h-[40px] sm:min-w-[48px] sm:min-h-[48px] bg-dark-700 border border-dark-500 rounded-md flex flex-col items-center justify-center"
                          title={`#${plant.plantNumber} — не записан`}
                        >
                          <span className="text-[10px] font-bold text-dark-400">{plant.plantNumber}</span>
                          <span className="text-[8px] text-dark-500">—</span>
                        </div>
                      );
                    }

                    // Куст с весом — тепловой цвет
                    const color = getHeatColor(plant.wetWeight);
                    return (
                      <div
                        key={posIdx}
                        className="min-w-[40px] min-h-[40px] sm:min-w-[48px] sm:min-h-[48px] rounded-md flex flex-col items-center justify-center transition"
                        style={{
                          backgroundColor: color.bg,
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: color.border,
                        }}
                        title={`#${plant.plantNumber} — ${plant.wetWeight}г${plant.strain ? ` (${plant.strain})` : ''}`}
                      >
                        <span
                          className="text-[10px] font-bold leading-tight"
                          style={{ color: color.text }}
                        >
                          {plant.plantNumber}
                        </span>
                        <span
                          className="text-[8px] leading-tight"
                          style={{ color: color.text, opacity: 0.8 }}
                        >
                          {plant.wetWeight}г
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Легенда градиента */}
      {weights.length > 1 && range > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-dark-400 whitespace-nowrap">{minWeight}г</span>
            <div
              className="flex-1 h-3 rounded-full"
              style={{
                background: 'linear-gradient(to right, hsl(0, 70%, 30%), hsl(60, 70%, 30%), hsl(120, 70%, 30%))'
              }}
            />
            <span className="text-[10px] text-dark-400 whitespace-nowrap">{maxWeight}г</span>
          </div>
          <div className="flex justify-center">
            <span className="text-[10px] text-dark-500">лёгкий → тяжёлый</span>
          </div>
        </div>
      )}

      {/* Статистика */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-dark-400">
        <span>Кустов: <span className="text-white font-medium">{weights.length}</span></span>
        <span>Средний: <span className="text-white font-medium">{avgWeight}г</span></span>
        {range > 0 && (
          <span>Разброс: <span className="text-red-400">{minWeight}г</span> — <span className="text-green-400">{maxWeight}г</span></span>
        )}
        {weights.length > 0 && (
          <span>Общий: <span className="text-white font-medium">{weights.reduce((s, w) => s + w, 0)}г</span></span>
        )}
      </div>
    </div>
  );
}
