import { useState } from 'react';

export default function RoomMapSetup({ currentRows, currentPositions, plantsCount, onApply }) {
  const [rows, setRows] = useState(currentRows || 4);
  const [positionsPerRow, setPositionsPerRow] = useState(currentPositions || 10);

  const totalPositions = rows * positionsPerRow;
  const diff = totalPositions - (plantsCount || 0);

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-lg p-4">
      <h3 className="text-white font-semibold text-sm mb-3">Настройка сетки комнаты</h3>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-dark-400 text-xs mb-1">Рядов</label>
          <input
            type="number"
            min={1}
            max={20}
            value={rows}
            onChange={(e) => setRows(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
            className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm"
          />
        </div>
        <div>
          <label className="block text-dark-400 text-xs mb-1">Позиций в ряду</label>
          <input
            type="number"
            min={1}
            max={30}
            value={positionsPerRow}
            onChange={(e) => setPositionsPerRow(Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))}
            className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-white text-sm"
          />
        </div>
      </div>

      <div className="text-dark-400 text-xs mb-3">
        <span className="text-white font-medium">{rows}</span> рядов × <span className="text-white font-medium">{positionsPerRow}</span> позиций = <span className="text-white font-medium">{totalPositions}</span> мест
        {plantsCount > 0 && (
          <>
            {' '}для <span className="text-primary-400 font-medium">{plantsCount}</span> кустов
            {diff > 0 && <span className="text-dark-500"> ({diff} свободных)</span>}
            {diff < 0 && <span className="text-red-400"> (не хватает {Math.abs(diff)} мест!)</span>}
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => onApply(rows, positionsPerRow)}
        className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 transition"
      >
        Применить
      </button>
    </div>
  );
}
