import { STRAIN_COLORS } from './PlantCell';

function getStrainIndex(plantNumber, flowerStrains) {
  if (!flowerStrains || !plantNumber) return -1;
  return flowerStrains.findIndex(
    fs => plantNumber >= fs.startNumber && plantNumber <= fs.endNumber
  );
}

/**
 * Компактная мини-карта комнаты для встраивания в карточки.
 * Показывает цветные точки растений без интерактивности.
 */
export default function RoomMapMini({ room, onClick }) {
  const layout = room?.roomLayout;
  if (!layout?.customRows?.length) return null;

  const customRows = layout.customRows;
  const posMap = {};
  (layout.plantPositions || []).forEach(p => {
    posMap[`${p.row}:${p.position}`] = p.plantNumber;
  });

  const flowerStrains = room.flowerStrains || [];
  const hasPlants = (layout.plantPositions || []).length > 0;
  if (!hasPlants) return null;

  return (
    <div
      onClick={onClick}
      className={`flex gap-1.5 overflow-hidden ${onClick ? 'cursor-pointer' : ''}`}
      title="Карта комнаты"
    >
      {customRows.map((row, rowIdx) => {
        const cols = row.cols || 1;
        const rowsCount = row.rows || 1;
        return (
          <div key={rowIdx} className="flex flex-col items-center shrink-0">
            <div
              className="grid gap-px"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: rowsCount }, (_, rIdx) =>
                Array.from({ length: cols }, (_, cIdx) => {
                  const posIdx = rIdx * cols + cIdx;
                  const plantNumber = posMap[`${rowIdx}:${posIdx}`];
                  const strainIdx = plantNumber ? getStrainIndex(plantNumber, flowerStrains) : -1;

                  if (strainIdx >= 0) {
                    const color = STRAIN_COLORS[strainIdx % STRAIN_COLORS.length];
                    return (
                      <div
                        key={posIdx}
                        className={`w-2 h-2 rounded-sm ${color.dot}`}
                      />
                    );
                  }
                  return (
                    <div
                      key={posIdx}
                      className="w-2 h-2 rounded-sm bg-dark-700"
                    />
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
