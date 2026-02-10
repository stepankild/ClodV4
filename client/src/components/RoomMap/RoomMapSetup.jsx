import { useState } from 'react';

export default function RoomMapSetup({ currentRows, plantsCount, onApply }) {
  const [customRows, setCustomRows] = useState(
    currentRows && currentRows.length > 0
      ? currentRows.map(r => ({
          name: r.name || '',
          cols: r.cols || r.positions || 4,
          rows: r.rows || 1
        }))
      : [{ name: 'Ряд 1', cols: 4, rows: 1 }]
  );

  const totalPositions = customRows.reduce((sum, r) => sum + (r.cols || 1) * (r.rows || 1), 0);
  const diff = totalPositions - (plantsCount || 0);

  const updateRow = (idx, field, value) => {
    setCustomRows(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const addRow = () => {
    setCustomRows(prev => [...prev, { name: `Ряд ${prev.length + 1}`, cols: 4, rows: 1 }]);
  };

  const removeRow = (idx) => {
    if (customRows.length <= 1) return;
    setCustomRows(prev => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="bg-dark-800 border border-dark-700 rounded-lg p-4">
      <h3 className="text-white font-semibold text-sm mb-3">Настройка рядов комнаты</h3>

      <div className="space-y-2 mb-3">
        {customRows.map((row, idx) => {
          const positions = (row.cols || 1) * (row.rows || 1);
          return (
            <div key={idx} className="bg-dark-700/30 rounded-lg p-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateRow(idx, 'name', e.target.value)}
                  placeholder={`Ряд ${idx + 1}`}
                  className="flex-1 min-w-0 bg-dark-700 border border-dark-600 rounded-lg px-3 py-1.5 text-white text-sm"
                />
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
              <div className="flex items-center gap-2 text-xs">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={row.cols}
                    onChange={(e) => updateRow(idx, 'cols', Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))}
                    className="w-12 bg-dark-700 border border-dark-600 rounded px-1.5 py-1 text-white text-xs text-center"
                  />
                  <span className="text-dark-500">по горизонтали</span>
                </div>
                <span className="text-dark-600">×</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={row.rows}
                    onChange={(e) => updateRow(idx, 'rows', Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                    className="w-12 bg-dark-700 border border-dark-600 rounded px-1.5 py-1 text-white text-xs text-center"
                  />
                  <span className="text-dark-500">по вертикали</span>
                </div>
                <span className="text-dark-400 ml-auto">= <span className="text-white font-medium">{positions}</span> мест</span>
              </div>
            </div>
          );
        })}
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
