import { useState } from 'react';

export default function RoomMapSetup({ currentRows, plantsCount, onApply }) {
  const [customRows, setCustomRows] = useState(
    currentRows && currentRows.length > 0
      ? currentRows.map(r => ({ name: r.name || '', positions: r.positions || 10 }))
      : [{ name: 'Ряд 1', positions: 10 }]
  );

  const totalPositions = customRows.reduce((sum, r) => sum + (r.positions || 0), 0);
  const diff = totalPositions - (plantsCount || 0);

  const updateRow = (idx, field, value) => {
    setCustomRows(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const addRow = () => {
    setCustomRows(prev => [...prev, { name: `Ряд ${prev.length + 1}`, positions: 10 }]);
  };

  const removeRow = (idx) => {
    if (customRows.length <= 1) return;
    setCustomRows(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-lg p-4">
      <h3 className="text-white font-semibold text-sm mb-3">Настройка рядов комнаты</h3>

      <div className="space-y-2 mb-3">
        {customRows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="text"
              value={row.name}
              onChange={(e) => updateRow(idx, 'name', e.target.value)}
              placeholder={`Ряд ${idx + 1}`}
              className="flex-1 min-w-0 bg-dark-700 border border-dark-600 rounded-lg px-3 py-1.5 text-white text-sm"
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={50}
                value={row.positions}
                onChange={(e) => updateRow(idx, 'positions', Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                className="w-16 bg-dark-700 border border-dark-600 rounded-lg px-2 py-1.5 text-white text-sm text-center"
              />
              <span className="text-dark-500 text-xs">мест</span>
            </div>
            {customRows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(idx)}
                className="text-dark-500 hover:text-red-400 text-lg leading-none px-1 shrink-0"
                title="Удалить ряд"
              >
                &#10005;
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="text-sm text-primary-400 hover:text-primary-300 mb-3 block"
      >
        + Добавить ряд
      </button>

      <div className="text-dark-400 text-xs mb-3">
        <span className="text-white font-medium">{customRows.length}</span> рядов, <span className="text-white font-medium">{totalPositions}</span> мест всего
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
        onClick={() => onApply(customRows)}
        className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 transition"
      >
        Применить
      </button>
    </div>
  );
}
