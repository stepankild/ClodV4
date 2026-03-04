import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import VegMapCell from './VegMapCell';
import { STRAIN_COLORS } from '../RoomMap/PlantCell';

export default function VegMap({ vegMapData, batches, onSave, saving }) {
  const { t } = useTranslation();

  // vegRows: [{name, tablesCount, plantsPerTable, tableCols, tableGapAfterCol}]
  const [vegRows, setVegRows] = useState(
    vegMapData?.vegRows?.length > 0
      ? vegMapData.vegRows
      : []
  );
  const [batchPositions, setBatchPositions] = useState(vegMapData?.batchPositions || []);
  const [editMode, setEditMode] = useState(false);
  const [showSetup, setShowSetup] = useState((vegMapData?.vegRows || []).length === 0);
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Setup state
  const [setupRows, setSetupRows] = useState(
    vegRows.length > 0
      ? vegRows.map(r => ({ ...r }))
      : [{ name: `${t('vegMap.rowDefault')} 1`, tablesCount: 8, plantsPerTable: 54, tableCols: 4, tableGapAfterCol: 2 }]
  );

  // Compute flat table list from vegRows for rendering
  const flatTables = useMemo(() => {
    const tables = [];
    vegRows.forEach((row, rowIdx) => {
      for (let ti = 0; ti < row.tablesCount; ti++) {
        tables.push({
          rowIdx,
          tableInRow: ti,
          flatIdx: tables.length,
          rowName: row.name,
          plantsPerTable: row.plantsPerTable,
          tableCols: row.tableCols || 4,
          tableGapAfterCol: row.tableGapAfterCol || 0
        });
      }
    });
    return tables;
  }, [vegRows]);

  // Mapping batchId -> index for colors
  const batchIndexMap = useMemo(() => {
    const m = {};
    batches.forEach((b, i) => { m[b._id] = i; });
    return m;
  }, [batches]);

  // Mapping batchId -> name
  const batchNameMap = useMemo(() => {
    const m = {};
    batches.forEach(b => { m[b._id] = b.name || '—'; });
    return m;
  }, [batches]);

  // Mapping cell -> batchId
  const positionMap = useMemo(() => {
    const m = {};
    batchPositions.forEach(p => {
      const bid = typeof p.batchId === 'object' ? (p.batchId?._id || p.batchId) : p.batchId;
      m[`${p.row}:${p.position}`] = String(bid);
    });
    return m;
  }, [batchPositions]);

  // Count cells per batch
  const batchCellCounts = useMemo(() => {
    const counts = {};
    Object.values(positionMap).forEach(bid => {
      counts[bid] = (counts[bid] || 0) + 1;
    });
    return counts;
  }, [positionMap]);

  const totalSpots = useMemo(() => {
    return vegRows.reduce((s, r) => s + r.tablesCount * r.plantsPerTable, 0);
  }, [vegRows]);

  // Setup handlers
  const updateSetupRow = (idx, field, value) => {
    setSetupRows(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const addSetupRow = () => {
    setSetupRows(prev => [...prev, {
      name: `${t('vegMap.rowDefault')} ${prev.length + 1}`,
      tablesCount: 8,
      plantsPerTable: 54,
      tableCols: 4,
      tableGapAfterCol: 2
    }]);
  };

  const removeSetupRow = (idx) => {
    if (setupRows.length <= 1) return;
    setSetupRows(prev => prev.filter((_, i) => i !== idx));
  };

  const handleApplySetup = () => {
    const newRows = setupRows.map(r => ({
      name: r.name,
      tablesCount: Math.max(1, Math.min(50, r.tablesCount)),
      plantsPerTable: Math.max(1, Math.min(200, r.plantsPerTable)),
      tableCols: Math.max(1, Math.min(10, r.tableCols)),
      tableGapAfterCol: Math.max(0, Math.min(r.tableCols - 1, r.tableGapAfterCol))
    }));

    // Calculate total tables in new layout to clean positions
    const totalNewTables = newRows.reduce((s, r) => s + r.tablesCount, 0);
    const cleaned = batchPositions.filter(p => {
      if (p.row >= totalNewTables) return false;
      // Find which row/table this flatIdx belongs to
      let remaining = p.row;
      for (const r of newRows) {
        if (remaining < r.tablesCount) {
          if (p.position >= r.plantsPerTable) return false;
          return true;
        }
        remaining -= r.tablesCount;
      }
      return false;
    });

    setVegRows(newRows);
    setBatchPositions(cleaned);
    setShowSetup(false);
  };

  const handleCellClick = useCallback((flatTableIdx, posIdx) => {
    if (!editMode) return;
    const key = `${flatTableIdx}:${posIdx}`;
    const existing = positionMap[key];

    if (existing) {
      setBatchPositions(prev => prev.filter(p => !(p.row === flatTableIdx && p.position === posIdx)));
    } else if (activeBatchId) {
      setBatchPositions(prev => [...prev, { row: flatTableIdx, position: posIdx, batchId: activeBatchId }]);
    }
  }, [editMode, positionMap, activeBatchId]);

  const handleFillTable = (flatTableIdx) => {
    if (!activeBatchId) return;
    const table = flatTables[flatTableIdx];
    if (!table) return;
    const total = table.plantsPerTable;
    const cleaned = batchPositions.filter(p => p.row !== flatTableIdx);
    const newPositions = [...cleaned];
    for (let p = 0; p < total; p++) {
      newPositions.push({ row: flatTableIdx, position: p, batchId: activeBatchId });
    }
    setBatchPositions(newPositions);
  };

  const handleClearTable = (flatTableIdx) => {
    setBatchPositions(prev => prev.filter(p => p.row !== flatTableIdx));
  };

  const handleFillRow = (rowIdx) => {
    if (!activeBatchId) return;
    const tablesInRow = flatTables.filter(t => t.rowIdx === rowIdx);
    const flatIdxs = new Set(tablesInRow.map(t => t.flatIdx));
    const cleaned = batchPositions.filter(p => !flatIdxs.has(p.row));
    const newPositions = [...cleaned];
    tablesInRow.forEach(table => {
      for (let p = 0; p < table.plantsPerTable; p++) {
        newPositions.push({ row: table.flatIdx, position: p, batchId: activeBatchId });
      }
    });
    setBatchPositions(newPositions);
  };

  const handleClearRow = (rowIdx) => {
    const tablesInRow = flatTables.filter(t => t.rowIdx === rowIdx);
    const flatIdxs = new Set(tablesInRow.map(t => t.flatIdx));
    setBatchPositions(prev => prev.filter(p => !flatIdxs.has(p.row)));
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
    await onSave({ vegRows, batchPositions: normalized });
    setEditMode(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleCancel = () => {
    setEditMode(false);
    setVegRows(vegMapData?.vegRows?.length > 0 ? vegMapData.vegRows : []);
    setBatchPositions(vegMapData?.batchPositions || []);
    setActiveBatchId(null);
  };

  const hasGrid = vegRows.length > 0;

  // ==================== SETUP SCREEN ====================
  if (showSetup || !hasGrid) {
    const setupTotalTables = setupRows.reduce((s, r) => s + (r.tablesCount || 0), 0);
    const setupTotalSpots = setupRows.reduce((s, r) => s + (r.tablesCount || 0) * (r.plantsPerTable || 0), 0);

    return (
      <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 space-y-4">
        <h3 className="text-white font-semibold text-sm">{t('vegMap.setupTitle')}</h3>

        <div className="space-y-3">
          {setupRows.map((row, idx) => (
            <div key={idx} className="bg-dark-700/30 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.name}
                  onChange={e => updateSetupRow(idx, 'name', e.target.value)}
                  placeholder={`${t('vegMap.rowDefault')} ${idx + 1}`}
                  className="flex-1 min-w-0 bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-white text-sm"
                />
                {setupRows.length > 1 && (
                  <button type="button" onClick={() => removeSetupRow(idx)}
                    className="text-dark-500 hover:text-red-400 text-lg leading-none px-1 shrink-0"
                  >&#10005;</button>
                )}
              </div>

              <div className="flex items-center gap-3 flex-wrap text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-dark-400">{t('vegMap.tablesInRow')}</span>
                  <input type="number" min={1} max={50}
                    value={row.tablesCount}
                    onChange={e => updateSetupRow(idx, 'tablesCount', Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                    className="w-14 bg-dark-700 border border-dark-600 rounded px-1.5 py-1 text-white text-xs text-center"
                  />
                </div>
                <span className="text-dark-600">×</span>
                <div className="flex items-center gap-1">
                  <span className="text-dark-400">{t('vegMap.plantsPerTable')}</span>
                  <input type="number" min={1} max={200}
                    value={row.plantsPerTable}
                    onChange={e => updateSetupRow(idx, 'plantsPerTable', Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))}
                    className="w-14 bg-dark-700 border border-dark-600 rounded px-1.5 py-1 text-white text-xs text-center"
                  />
                </div>
                <span className="text-dark-500">= <span className="text-white font-medium">{(row.tablesCount || 0) * (row.plantsPerTable || 0)}</span></span>
              </div>

              <div className="flex items-center gap-3 flex-wrap text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-dark-400">{t('vegMap.colsOnTable')}</span>
                  <input type="number" min={1} max={10}
                    value={row.tableCols}
                    onChange={e => {
                      const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
                      updateSetupRow(idx, 'tableCols', v);
                      // Reset gap if it's now invalid
                      if (row.tableGapAfterCol >= v) updateSetupRow(idx, 'tableGapAfterCol', 0);
                    }}
                    className="w-12 bg-dark-700 border border-dark-600 rounded px-1.5 py-1 text-white text-xs text-center"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-dark-400">{t('vegMap.gapAfterCol')}</span>
                  <input type="number" min={0} max={row.tableCols - 1}
                    value={row.tableGapAfterCol}
                    onChange={e => updateSetupRow(idx, 'tableGapAfterCol', Math.max(0, Math.min(row.tableCols - 1, parseInt(e.target.value) || 0)))}
                    className="w-12 bg-dark-700 border border-dark-600 rounded px-1.5 py-1 text-white text-xs text-center"
                  />
                </div>
                {row.tableGapAfterCol > 0 && (
                  <span className="text-dark-500">
                    {row.tableGapAfterCol}+{row.tableCols - row.tableGapAfterCol} {t('vegMap.colLayout')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <button type="button" onClick={addSetupRow}
          className="text-sm text-primary-400 hover:text-primary-300">
          {t('vegMap.addRow')}
        </button>

        <div className="text-dark-400 text-xs">
          <span className="text-white font-medium">{setupRows.length}</span> {t('vegMap.rowsWord')},
          {' '}<span className="text-white font-medium">{setupTotalTables}</span> {t('vegMap.tablesWord')},
          {' '}<span className="text-white font-medium">{setupTotalSpots}</span> {t('vegMap.spotsWord')}
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={handleApplySetup}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 transition">
            {t('roomMap.apply')}
          </button>
          {hasGrid && (
            <button type="button" onClick={() => setShowSetup(false)}
              className="px-4 py-2 text-dark-400 hover:text-dark-200 text-sm transition">
              {t('common.cancel')}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ==================== MAP VIEW ====================
  const assignedCount = Object.keys(positionMap).length;

  // Group flat tables by rowIdx
  const tablesByRow = [];
  vegRows.forEach((row, rowIdx) => {
    tablesByRow.push({
      row,
      rowIdx,
      tables: flatTables.filter(t => t.rowIdx === rowIdx)
    });
  });

  return (
    <div className="space-y-4">
      {/* Header + buttons */}
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
              <button type="button" onClick={() => { setSetupRows(vegRows.map(r => ({ ...r }))); setShowSetup(true); }}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition">{t('vegMap.setupBtn')}</button>
            </>
          )}
        </div>
      </div>

      {saveSuccess && (
        <div className="bg-green-900/30 border border-green-800 text-green-400 px-3 py-2 rounded-lg text-xs flex items-center justify-between">
          <span>{t('vegMap.mapSaved')}</span>
          <button type="button" onClick={() => setSaveSuccess(false)} className="text-green-500 hover:text-green-300 ml-2">&#10005;</button>
        </div>
      )}

      {/* Batch palette (edit mode) */}
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

      {/* Map: rows → tables → grid of cells */}
      {tablesByRow.map(({ row, rowIdx, tables }) => {
        const rowCellCount = tables.reduce((s, t) => {
          return s + batchPositions.filter(p => p.row === t.flatIdx).length;
        }, 0);
        const rowTotalSpots = row.tablesCount * row.plantsPerTable;

        return (
          <div key={rowIdx} className="space-y-1.5">
            {/* Row header */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-dark-300 font-medium">{row.name || `${t('vegMap.rowDefault')} ${rowIdx + 1}`}</span>
              <span className="text-[10px] text-dark-500">{rowCellCount}/{rowTotalSpots}</span>
              {editMode && (
                <>
                  <button type="button" onClick={() => handleFillRow(rowIdx)}
                    className="text-[10px] px-1.5 py-0.5 rounded text-dark-500 hover:text-dark-300 hover:bg-dark-700 transition"
                    title={t('vegMap.fillRow')}>&#9635; {t('vegMap.fillRow')}</button>
                  <button type="button" onClick={() => handleClearRow(rowIdx)}
                    className="text-[10px] px-1.5 py-0.5 rounded text-dark-500 hover:text-red-400 hover:bg-dark-700 transition"
                    title={t('vegMap.clearRow')}>&#10005; {t('vegMap.clearRow')}</button>
                </>
              )}
            </div>

            {/* Tables in row — horizontal scroll */}
            <div className="overflow-x-auto pb-1">
              <div className="flex gap-3 min-w-min">
                {tables.map((table) => {
                  const { flatIdx, plantsPerTable, tableCols, tableGapAfterCol } = table;
                  const tableRows = Math.ceil(plantsPerTable / tableCols);
                  const tableCellCount = batchPositions.filter(p => p.row === flatIdx).length;

                  return (
                    <div key={flatIdx} className="flex flex-col items-center shrink-0">
                      {/* Table header */}
                      <div className="flex items-center gap-0.5 mb-1">
                        <span className="text-[10px] text-dark-500 font-medium">
                          {table.tableInRow + 1}
                        </span>
                        {editMode && (
                          <>
                            <button type="button" onClick={() => handleFillTable(flatIdx)}
                              className="text-[8px] px-0.5 py-0.5 rounded text-dark-600 hover:text-dark-300 hover:bg-dark-700 transition"
                              title={t('vegMap.fillTable')}>&#9635;</button>
                            <button type="button" onClick={() => handleClearTable(flatIdx)}
                              className="text-[8px] px-0.5 py-0.5 rounded text-dark-600 hover:text-red-400 hover:bg-dark-700 transition"
                              title={t('vegMap.clearTable')}>&#10005;</button>
                          </>
                        )}
                      </div>

                      {/* Table grid: cols with optional gap */}
                      <div className="flex" style={{ gap: tableGapAfterCol > 0 ? 0 : '1px' }}>
                        {Array.from({ length: tableCols }, (_, colIdx) => {
                          // Insert visual gap after tableGapAfterCol
                          const showGapBefore = tableGapAfterCol > 0 && colIdx === tableGapAfterCol;

                          return (
                            <div key={colIdx} className="flex" style={{ gap: 0 }}>
                              {showGapBefore && (
                                <div className="w-1.5 sm:w-2" />
                              )}
                              <div className="flex flex-col" style={{ gap: '1px' }}>
                                {Array.from({ length: tableRows }, (_, rowInTable) => {
                                  const posIdx = rowInTable * tableCols + colIdx;
                                  if (posIdx >= plantsPerTable) {
                                    return <div key={rowInTable} className="w-[14px] h-[14px] sm:w-[16px] sm:h-[16px]" />;
                                  }
                                  const batchId = positionMap[`${flatIdx}:${posIdx}`];
                                  const batchIdx = batchId ? batchIndexMap[batchId] : undefined;
                                  const batchName = batchId ? batchNameMap[batchId] : undefined;
                                  return (
                                    <VegMapCell
                                      key={rowInTable}
                                      batchLabel={batchName}
                                      batchIndex={batchIdx}
                                      isEmpty={!batchId}
                                      isActive={editMode && !!activeBatchId && !batchId}
                                      onClick={() => handleCellClick(flatIdx, posIdx)}
                                      micro
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Fill count under table */}
                      {!editMode && tableCellCount > 0 && (
                        <span className="text-[8px] text-dark-600 mt-0.5">
                          {tableCellCount}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      {/* Batch legend */}
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
