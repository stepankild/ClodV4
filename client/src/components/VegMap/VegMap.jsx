import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import VegMapCell from './VegMapCell';
import { STRAIN_COLORS } from '../RoomMap/PlantCell';

function getRowPositions(row) {
  return (row.cols || 1) * (row.rows || 1);
}

export default function VegMap({ vegMapData, batches, onSave, saving }) {
  const { t } = useTranslation();

  const [customRows, setCustomRows] = useState(
    (vegMapData?.customRows || []).map(r => ({
      ...r,
      fillDirection: r.fillDirection || vegMapData?.fillDirection || 'topDown'
    }))
  );
  const [batchPositions, setBatchPositions] = useState(vegMapData?.batchPositions || []);
  const [editMode, setEditMode] = useState(false);
  const [showSetup, setShowSetup] = useState((vegMapData?.customRows || []).length === 0);
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Quick setup state
  const [tableCount, setTableCount] = useState(vegMapData?.customRows?.length || 21);
  const [spotsPerTable, setSpotsPerTable] = useState(
    vegMapData?.customRows?.[0]?.rows || 11
  );

  // Маппинг batchId -> индекс для цветов
  const batchIndexMap = useMemo(() => {
    const m = {};
    batches.forEach((b, i) => { m[b._id] = i; });
    return m;
  }, [batches]);

  // Маппинг batchId -> name
  const batchNameMap = useMemo(() => {
    const m = {};
    batches.forEach(b => { m[b._id] = b.name || '—'; });
    return m;
  }, [batches]);

  // Маппинг cell -> batchId
  const positionMap = useMemo(() => {
    const m = {};
    batchPositions.forEach(p => {
      const bid = typeof p.batchId === 'object' ? (p.batchId?._id || p.batchId) : p.batchId;
      m[`${p.row}:${p.position}`] = String(bid);
    });
    return m;
  }, [batchPositions]);

  // Кол-во ячеек по батчам
  const batchCellCounts = useMemo(() => {
    const counts = {};
    Object.values(positionMap).forEach(bid => {
      counts[bid] = (counts[bid] || 0) + 1;
    });
    return counts;
  }, [positionMap]);

  const totalSpots = useMemo(() => {
    return customRows.reduce((s, r) => s + getRowPositions(r), 0);
  }, [customRows]);

  const handleQuickSetup = () => {
    const tables = Math.max(1, Math.min(50, tableCount));
    const spots = Math.max(1, Math.min(50, spotsPerTable));
    const newRows = Array.from({ length: tables }, (_, i) => ({
      name: `${t('vegMap.tableDefault')} ${i + 1}`,
      cols: 1,
      rows: spots,
      fillDirection: 'topDown'
    }));
    // Фильтруем позиции которые не помещаются в новую сетку
    const cleaned = batchPositions.filter(p => {
      if (p.row >= tables) return false;
      if (p.position >= spots) return false;
      return true;
    });
    setCustomRows(newRows);
    setBatchPositions(cleaned);
    setShowSetup(false);
  };

  const handleCellClick = useCallback((rowIdx, posIdx) => {
    if (!editMode) return;
    const key = `${rowIdx}:${posIdx}`;
    const existing = positionMap[key];

    if (existing) {
      setBatchPositions(prev => prev.filter(p => !(p.row === rowIdx && p.position === posIdx)));
    } else if (activeBatchId) {
      setBatchPositions(prev => [...prev, { row: rowIdx, position: posIdx, batchId: activeBatchId }]);
    }
  }, [editMode, positionMap, activeBatchId]);

  const handleFillTable = (rowIdx) => {
    if (!activeBatchId) return;
    const total = getRowPositions(customRows[rowIdx]);
    const cleaned = batchPositions.filter(p => p.row !== rowIdx);
    const newPositions = [...cleaned];
    for (let p = 0; p < total; p++) {
      newPositions.push({ row: rowIdx, position: p, batchId: activeBatchId });
    }
    setBatchPositions(newPositions);
  };

  const handleClearTable = (rowIdx) => {
    setBatchPositions(prev => prev.filter(p => p.row !== rowIdx));
  };

  const handleClearAll = () => {
    setBatchPositions([]);
    setActiveBatchId(null);
  };

  const handleSave = async () => {
    const normalized = batchPositions.map(p => ({
      row: p.row,
      position: p.position,
      batchId: typeof p.batchId === 'object' ? (p.batchId?._id || p.batchId) : p.batchId
    }));
    await onSave({ customRows, batchPositions: normalized });
    setEditMode(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleCancel = () => {
    setEditMode(false);
    setCustomRows((vegMapData?.customRows || []).map(r => ({
      ...r,
      fillDirection: r.fillDirection || vegMapData?.fillDirection || 'topDown'
    })));
    setBatchPositions(vegMapData?.batchPositions || []);
    setActiveBatchId(null);
  };

  const hasGrid = customRows.length > 0;

  // Быстрая настройка столов
  if (showSetup || !hasGrid) {
    return (
      <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 space-y-4">
        <h3 className="text-white font-semibold text-sm">{t('vegMap.setupTitle')}</h3>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-dark-300">{t('vegMap.tablesCount')}</label>
            <input
              type="number"
              min={1} max={50}
              value={tableCount}
              onChange={e => setTableCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
              className="w-16 bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-white text-sm text-center"
            />
          </div>
          <span className="text-dark-600">×</span>
          <div className="flex items-center gap-2">
            <label className="text-sm text-dark-300">{t('vegMap.spotsPerTable')}</label>
            <input
              type="number"
              min={1} max={50}
              value={spotsPerTable}
              onChange={e => setSpotsPerTable(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
              className="w-16 bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-white text-sm text-center"
            />
          </div>
          <span className="text-dark-400 text-sm">= <span className="text-white font-medium">{tableCount * spotsPerTable}</span> {t('vegMap.spotsWord')}</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleQuickSetup}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 transition"
          >
            {t('roomMap.apply')}
          </button>
          {hasGrid && (
            <button
              type="button"
              onClick={() => setShowSetup(false)}
              className="px-4 py-2 text-dark-400 hover:text-dark-200 text-sm transition"
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      </div>
    );
  }

  const assignedCount = Object.keys(positionMap).length;

  return (
    <div className="space-y-4">
      {/* Заголовок + кнопки */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-medium text-white">
          {t('vegMap.title')}
          <span className="text-dark-400 font-normal ml-2">
            {assignedCount}/{totalSpots} {t('vegMap.spotsUsed')}
          </span>
        </h4>
        <div className="flex gap-2 flex-wrap">
          {editMode ? (
            <>
              <button type="button" onClick={handleClearAll}
                className="px-2 py-1 text-xs bg-dark-700 text-red-400 rounded hover:bg-dark-600 transition">{t('vegMap.clear')}</button>
              <button type="button" onClick={() => setShowSetup(true)}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition">{t('vegMap.setupBtn')}</button>
              <button type="button" onClick={handleSave} disabled={saving}
                className="px-3 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-500 disabled:opacity-50 transition">
                {saving ? '...' : t('common.save')}</button>
              <button type="button" onClick={handleCancel}
                className="px-3 py-1 text-xs text-dark-400 hover:bg-dark-700 rounded transition">{t('common.cancel')}</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setEditMode(true)}
                className="px-3 py-1 text-xs bg-dark-700 text-white rounded hover:bg-dark-600 transition">{t('common.edit')}</button>
              <button type="button" onClick={() => setShowSetup(true)}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition">{t('vegMap.setupBtn')}</button>
            </>
          )}
        </div>
      </div>

      {saveSuccess && (
        <div className="bg-green-900/30 border border-green-800 text-green-400 px-3 py-2 rounded-lg text-xs flex items-center justify-between">
          <span>{t('vegMap.mapSaved')}</span>
          <button type="button" onClick={() => setSaveSuccess(false)} className="text-green-500 hover:text-green-300 ml-2">✕</button>
        </div>
      )}

      {/* Палитра батчей (в режиме редактирования) */}
      {editMode && (
        <div className="bg-dark-700/50 border border-dark-600 rounded-lg p-3">
          <div className="text-xs text-dark-400 mb-2">{t('vegMap.selectBatch')}</div>
          <div className="flex flex-wrap gap-2">
            {batches.map((b, idx) => {
              const color = STRAIN_COLORS[idx % STRAIN_COLORS.length];
              const isActive = activeBatchId === b._id;
              return (
                <button key={b._id} type="button"
                  onClick={() => setActiveBatchId(isActive ? null : b._id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${color.bg} ${color.border} ${color.text} ${
                    isActive ? 'ring-2 ring-white scale-105' : 'hover:brightness-125'
                  }`}>
                  {b.name || '—'}
                  <span className="ml-1 opacity-60">({batchCellCounts[b._id] || 0})</span>
                </button>
              );
            })}
            {batches.length === 0 && (
              <span className="text-xs text-dark-500">{t('vegMap.noBatches')}</span>
            )}
          </div>
        </div>
      )}

      {/* Карта столов — горизонтальная прокрутка, каждый стол = вертикальная колонка */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-1 min-w-min">
          {customRows.map((row, rowIdx) => {
            const spots = row.rows || 1;
            const tableCellCount = batchPositions.filter(p => p.row === rowIdx).length;

            return (
              <div key={rowIdx} className="flex flex-col items-center shrink-0">
                {/* Заголовок стола */}
                <div className="flex items-center gap-0.5 mb-1">
                  <span className="text-[10px] text-dark-500 font-medium whitespace-nowrap">
                    {row.name?.replace(`${t('vegMap.tableDefault')} `, '') || rowIdx + 1}
                  </span>
                  {editMode && (
                    <>
                      <button type="button"
                        onClick={() => handleFillTable(rowIdx)}
                        className="text-[9px] px-1 py-0.5 rounded text-dark-600 hover:text-dark-300 hover:bg-dark-700 transition"
                        title={t('vegMap.fillTable')}>▣</button>
                      <button type="button"
                        onClick={() => handleClearTable(rowIdx)}
                        className="text-[9px] px-0.5 py-0.5 rounded text-dark-600 hover:text-red-400 hover:bg-dark-700 transition"
                        title={t('vegMap.clearTable')}>✕</button>
                    </>
                  )}
                </div>

                {/* Вертикальная колонка ячеек */}
                <div className="flex flex-col gap-0.5">
                  {Array.from({ length: spots }, (_, posIdx) => {
                    const batchId = positionMap[`${rowIdx}:${posIdx}`];
                    const batchIdx = batchId ? batchIndexMap[batchId] : undefined;
                    const batchName = batchId ? batchNameMap[batchId] : undefined;
                    return (
                      <VegMapCell
                        key={posIdx}
                        batchLabel={batchName}
                        batchIndex={batchIdx}
                        isEmpty={!batchId}
                        isActive={editMode && activeBatchId && !batchId}
                        onClick={() => handleCellClick(rowIdx, posIdx)}
                        compact
                      />
                    );
                  })}
                </div>

                {/* Счётчик заполненности */}
                {!editMode && tableCellCount > 0 && (
                  <span className="text-[9px] text-dark-600 mt-1">
                    {tableCellCount}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Легенда батчей */}
      {batches.length > 0 && !editMode && (
        <div className="flex flex-wrap gap-3 text-xs">
          {batches.map((b, idx) => {
            const color = STRAIN_COLORS[idx % STRAIN_COLORS.length];
            const count = batchCellCounts[b._id] || 0;
            if (count === 0) return null;
            return (
              <div key={b._id} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                <span className="text-dark-300">{b.name || '—'}</span>
                <span className="text-dark-500">{count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
