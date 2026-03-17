import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import VegMapCell from './VegMapCell';
import { STRAIN_COLORS } from '../RoomMap/PlantCell';

// Default dead spots: center of first row (index 2 in a 5-col grid → 0*5+2=2)
const DEFAULT_DEAD_SPOTS = [2];

export default function VegMap({ vegMapData, batches, onSave, saving }) {
  const { t } = useTranslation();

  const [vegRows, setVegRows] = useState(
    vegMapData?.vegRows?.length > 0 ? vegMapData.vegRows : []
  );
  const [batchPositions, setBatchPositions] = useState(vegMapData?.batchPositions || []);
  const [editMode, setEditMode] = useState(false);
  const [showSetup, setShowSetup] = useState((vegMapData?.vegRows || []).length === 0);
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Setup state
  const [setupRows, setSetupRows] = useState(
    vegRows.length > 0
      ? vegRows.map(r => ({ ...r, deadSpots: r.deadSpots || [] }))
      : [{ name: `${t('vegMap.rowDefault')} 1`, tablesCount: 8, plantsPerTable: 54, tableCols: 5, tableRows: 11, deadSpots: DEFAULT_DEAD_SPOTS }]
  );

  // Flat table list
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
          tableCols: row.tableCols || 5,
          tableRows: row.tableRows || 11,
          deadSpots: new Set(row.deadSpots || [])
        });
      }
    });
    return tables;
  }, [vegRows]);

  const batchIndexMap = useMemo(() => {
    const m = {};
    batches.forEach((b, i) => { m[b._id] = i; });
    return m;
  }, [batches]);

  const batchNameMap = useMemo(() => {
    const m = {};
    batches.forEach(b => { m[b._id] = b.name || '—'; });
    return m;
  }, [batches]);

  // Strain label per batch (short name for cell display)
  const batchStrainMap = useMemo(() => {
    const m = {};
    batches.forEach(b => {
      const strains = Array.isArray(b.strains) && b.strains.length > 0
        ? b.strains.map(s => s.strain).filter(Boolean)
        : (b.strain ? [b.strain] : []);
      m[b._id] = strains.length > 0 ? strains[0] : (b.name || '');
    });
    return m;
  }, [batches]);

  // Available (good) plant count per batch
  const batchGoodCountMap = useMemo(() => {
    const m = {};
    batches.forEach(b => {
      const fromStrains = Array.isArray(b.strains) && b.strains.length > 0
        ? b.strains.reduce((s, x) => s + (Number(x.quantity) || 0), 0)
        : 0;
      const total = fromStrains || Number(b.quantity) || 0;
      const died = Number(b.diedCount) || 0;
      const disposed = Number(b.disposedCount) || 0;
      m[b._id] = Math.max(0, total - died - disposed);
    });
    return m;
  }, [batches]);

  const positionMap = useMemo(() => {
    const m = {};
    batchPositions.forEach(p => {
      const bid = typeof p.batchId === 'object' ? (p.batchId?._id || p.batchId) : p.batchId;
      m[`${p.row}:${p.position}`] = String(bid);
    });
    return m;
  }, [batchPositions]);

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
      tablesCount: 8, plantsPerTable: 54, tableCols: 5, tableRows: 11,
      deadSpots: DEFAULT_DEAD_SPOTS
    }]);
  };

  const removeSetupRow = (idx) => {
    if (setupRows.length <= 1) return;
    setSetupRows(prev => prev.filter((_, i) => i !== idx));
  };

  // Recalculate plantsPerTable based on grid and dead spots
  const calcPlants = (cols, rows, deadSpots) => {
    return cols * rows - (deadSpots?.length || 0);
  };

  const toggleDeadSpot = (rowIdx, gridIdx) => {
    setSetupRows(prev => {
      const updated = [...prev];
      const row = { ...updated[rowIdx] };
      const ds = [...(row.deadSpots || [])];
      const i = ds.indexOf(gridIdx);
      if (i >= 0) ds.splice(i, 1);
      else ds.push(gridIdx);
      row.deadSpots = ds;
      row.plantsPerTable = calcPlants(row.tableCols, row.tableRows, ds);
      return [...prev.slice(0, rowIdx), row, ...prev.slice(rowIdx + 1)];
    });
  };

  const handleApplySetup = () => {
    const newRows = setupRows.map(r => ({
      name: r.name,
      tablesCount: Math.max(1, Math.min(50, r.tablesCount)),
      plantsPerTable: calcPlants(r.tableCols, r.tableRows, r.deadSpots),
      tableCols: Math.max(1, Math.min(20, r.tableCols)),
      tableRows: Math.max(1, Math.min(50, r.tableRows)),
      deadSpots: r.deadSpots || []
    }));

    const totalNewTables = newRows.reduce((s, r) => s + r.tablesCount, 0);
    const cleaned = batchPositions.filter(p => {
      if (p.row >= totalNewTables) return false;
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

  // Check if batch has capacity left
  const canPlaceBatch = useCallback((batchId, extraCount = 1) => {
    const goodCount = batchGoodCountMap[batchId] || 0;
    const placed = batchCellCounts[batchId] || 0;
    return placed + extraCount <= goodCount;
  }, [batchGoodCountMap, batchCellCounts]);

  const handleCellClick = useCallback((flatTableIdx, posIdx) => {
    if (!editMode) return;
    const key = `${flatTableIdx}:${posIdx}`;
    const existing = positionMap[key];
    if (existing) {
      setBatchPositions(prev => prev.filter(p => !(p.row === flatTableIdx && p.position === posIdx)));
    } else if (activeBatchId) {
      if (!canPlaceBatch(activeBatchId)) return; // limit reached
      setBatchPositions(prev => [...prev, { row: flatTableIdx, position: posIdx, batchId: activeBatchId }]);
    }
  }, [editMode, positionMap, activeBatchId, canPlaceBatch]);

  const handleFillTable = (flatTableIdx) => {
    if (!activeBatchId) return;
    const table = flatTables[flatTableIdx];
    if (!table) return;
    const cleaned = batchPositions.filter(p => p.row !== flatTableIdx);
    // Count how many of this batch are already placed (elsewhere)
    const placedElsewhere = cleaned.filter(p => {
      const bid = typeof p.batchId === 'object' ? (p.batchId?._id || p.batchId) : p.batchId;
      return String(bid) === String(activeBatchId);
    }).length;
    const goodCount = batchGoodCountMap[activeBatchId] || 0;
    const canPlace = Math.max(0, goodCount - placedElsewhere);
    const toPlace = Math.min(table.plantsPerTable, canPlace);
    const newPositions = [...cleaned];
    for (let p = 0; p < toPlace; p++) {
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
    // Count how many of this batch are placed outside this row
    const placedElsewhere = cleaned.filter(p => {
      const bid = typeof p.batchId === 'object' ? (p.batchId?._id || p.batchId) : p.batchId;
      return String(bid) === String(activeBatchId);
    }).length;
    const goodCount = batchGoodCountMap[activeBatchId] || 0;
    let remaining = Math.max(0, goodCount - placedElsewhere);
    const newPositions = [...cleaned];
    tablesInRow.forEach(table => {
      const toPlace = Math.min(table.plantsPerTable, remaining);
      for (let p = 0; p < toPlace; p++) {
        newPositions.push({ row: table.flatIdx, position: p, batchId: activeBatchId });
      }
      remaining -= toPlace;
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
    const setupTotalSpots = setupRows.reduce((s, r) => s + (r.tablesCount || 0) * calcPlants(r.tableCols, r.tableRows, r.deadSpots), 0);

    return (
      <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 space-y-4">
        <h3 className="text-white font-semibold text-sm">{t('vegMap.setupTitle')}</h3>

        <div className="space-y-3">
          {setupRows.map((row, idx) => {
            const gridTotal = (row.tableCols || 5) * (row.tableRows || 11);
            const deadSet = new Set(row.deadSpots || []);
            const plants = calcPlants(row.tableCols, row.tableRows, row.deadSpots);

            return (
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
                  <div className="flex items-center gap-1">
                    <span className="text-dark-400">{t('vegMap.colsOnTable')}</span>
                    <input type="number" min={1} max={20}
                      value={row.tableCols}
                      onChange={e => {
                        const v = Math.max(1, Math.min(20, parseInt(e.target.value) || 1));
                        updateSetupRow(idx, 'tableCols', v);
                        // Recalc plants
                        const newPlants = calcPlants(v, row.tableRows, row.deadSpots);
                        updateSetupRow(idx, 'plantsPerTable', newPlants);
                      }}
                      className="w-12 bg-dark-700 border border-dark-600 rounded px-1.5 py-1 text-white text-xs text-center"
                    />
                  </div>
                  <span className="text-dark-600">×</span>
                  <div className="flex items-center gap-1">
                    <span className="text-dark-400">{t('vegMap.rowsOnTable')}</span>
                    <input type="number" min={1} max={50}
                      value={row.tableRows}
                      onChange={e => {
                        const v = Math.max(1, Math.min(50, parseInt(e.target.value) || 1));
                        updateSetupRow(idx, 'tableRows', v);
                        const newPlants = calcPlants(row.tableCols, v, row.deadSpots);
                        updateSetupRow(idx, 'plantsPerTable', newPlants);
                      }}
                      className="w-12 bg-dark-700 border border-dark-600 rounded px-1.5 py-1 text-white text-xs text-center"
                    />
                  </div>
                  <span className="text-dark-500">
                    = <span className="text-white font-medium">{plants}</span> {t('vegMap.plantsWord')} × {row.tablesCount} = <span className="text-white font-medium">{plants * (row.tablesCount || 0)}</span>
                  </span>
                </div>

                {/* Dead spot preview — mini table grid */}
                <div className="space-y-1">
                  <span className="text-[10px] text-dark-500">{t('vegMap.deadSpotsLabel')} ({(row.deadSpots || []).length})</span>
                  <div className="inline-flex flex-col gap-px bg-dark-800/50 rounded p-1">
                    {Array.from({ length: Math.min(row.tableRows || 11, 3) }, (_, r) => (
                      <div key={r} className="flex gap-px">
                        {Array.from({ length: row.tableCols || 5 }, (_, c) => {
                          const gi = r * (row.tableCols || 5) + c;
                          const isDead = deadSet.has(gi);
                          return (
                            <button key={c} type="button"
                              onClick={() => toggleDeadSpot(idx, gi)}
                              className={`w-4 h-4 rounded-[2px] border transition text-[7px] leading-none flex items-center justify-center ${
                                isDead
                                  ? 'bg-red-900/50 border-red-700 text-red-400'
                                  : 'bg-dark-600/50 border-dark-600 hover:border-dark-400'
                              }`}
                              title={isDead ? t('vegMap.removeDead') : t('vegMap.addDead')}
                            >{isDead ? '×' : ''}</button>
                          );
                        })}
                      </div>
                    ))}
                    {(row.tableRows || 11) > 3 && (
                      <div className="text-[8px] text-dark-600 text-center">...{(row.tableRows || 11) - 3} {t('vegMap.moreRows')}</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
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

  // Group tables by row
  const tablesByRow = vegRows.map((row, rowIdx) => ({
    row,
    rowIdx,
    tables: flatTables.filter(t => t.rowIdx === rowIdx)
  }));

  // Render a single table grid
  const renderTable = (table, editMode) => {
    const { flatIdx, plantsPerTable, tableCols, tableRows: tRows, deadSpots } = table;
    const tableCellCount = batchPositions.filter(p => p.row === flatIdx).length;

    // Map grid index → position index (skipping dead spots)
    // posIdx is sequential among live spots
    let posCounter = 0;
    const gridToPosMap = {};
    for (let gi = 0; gi < tableCols * tRows; gi++) {
      if (!deadSpots.has(gi)) {
        gridToPosMap[gi] = posCounter++;
      }
    }

    return (
      <div key={flatIdx} className="flex flex-col items-center shrink-0">
        {/* Table header */}
        <div className="flex items-center gap-0.5 mb-0.5">
          <span className="text-[9px] text-dark-500 font-medium">{table.tableInRow + 1}</span>
          {editMode && (
            <>
              <button type="button" onClick={() => handleFillTable(flatIdx)}
                className="text-[8px] px-0.5 rounded text-dark-600 hover:text-dark-300 hover:bg-dark-700 transition"
                title={t('vegMap.fillTable')}>&#9635;</button>
              <button type="button" onClick={() => handleClearTable(flatIdx)}
                className="text-[8px] px-0.5 rounded text-dark-600 hover:text-red-400 hover:bg-dark-700 transition"
                title={t('vegMap.clearTable')}>&#10005;</button>
            </>
          )}
        </div>

        {/* Table grid */}
        <div className="flex flex-col" style={{ gap: '1px' }}>
          {Array.from({ length: tRows }, (_, rowInTable) => (
            <div key={rowInTable} className="flex" style={{ gap: '1px' }}>
              {Array.from({ length: tableCols }, (_, colIdx) => {
                const gridIdx = rowInTable * tableCols + colIdx;
                const isDead = deadSpots.has(gridIdx);

                if (isDead) {
                  return <div key={colIdx} className="w-[18px] h-[18px] sm:w-[20px] sm:h-[20px]" />;
                }

                const posIdx = gridToPosMap[gridIdx];
                const batchId = positionMap[`${flatIdx}:${posIdx}`];
                const batchIdx = batchId ? batchIndexMap[batchId] : undefined;
                const batchName = batchId ? batchNameMap[batchId] : undefined;
                const strainLabel = batchId ? batchStrainMap[batchId] : undefined;

                return (
                  <VegMapCell
                    key={colIdx}
                    batchLabel={batchName}
                    strainLabel={strainLabel}
                    batchIndex={batchIdx}
                    isEmpty={!batchId}
                    isActive={editMode && !!activeBatchId && !batchId}
                    onClick={() => handleCellClick(flatIdx, posIdx)}
                    micro
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Fill count */}
        {!editMode && tableCellCount > 0 && (
          <span className="text-[8px] text-dark-600 mt-0.5">{tableCellCount}</span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
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
              <button type="button" onClick={() => { setSetupRows(vegRows.map(r => ({ ...r, deadSpots: r.deadSpots || [] }))); setShowSetup(true); }}
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

      {/* Batch palette */}
      {editMode && (
        <div className="bg-dark-700/50 border border-dark-600 rounded-lg p-3">
          <div className="text-xs text-dark-400 mb-2">{t('vegMap.selectBatch')}</div>
          <div className="flex flex-wrap gap-2">
            {batches.map((b, idx) => {
              const color = STRAIN_COLORS[idx % STRAIN_COLORS.length];
              const isActive = activeBatchId === b._id;
              const placed = batchCellCounts[b._id] || 0;
              const goodCount = batchGoodCountMap[b._id] || 0;
              const isFull = placed >= goodCount;
              return (
                <button key={b._id} type="button"
                  onClick={() => setActiveBatchId(isActive ? null : b._id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${color.bg} ${color.border} ${color.text} ${
                    isActive ? 'ring-2 ring-white scale-105' : 'hover:brightness-125'
                  } ${isFull && !isActive ? 'opacity-50' : ''}`}>
                  {b.name || '—'}
                  <span className={`ml-1 ${isFull ? 'text-red-400/80' : 'opacity-60'}`}>
                    {placed}/{goodCount}
                  </span>
                  {goodCount - placed > 0 && !isActive && (
                    <span className="ml-1 text-amber-400">+{goodCount - placed}</span>
                  )}
                </button>
              );
            })}
            {batches.length === 0 && (
              <span className="text-xs text-dark-500">{t('vegMap.noBatches')}</span>
            )}
          </div>
        </div>
      )}

      {/* Map: ряды горизонтально, столы в ряду вертикально */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-4 min-w-min">
          {tablesByRow.map(({ row, rowIdx, tables }) => {
            const rowCellCount = tables.reduce((s, t) =>
              s + batchPositions.filter(p => p.row === t.flatIdx).length, 0);
            const rowTotalSpots = row.tablesCount * row.plantsPerTable;

            return (
              <div key={rowIdx} className="flex flex-col items-center shrink-0">
                {/* Row header */}
                <div className="flex items-center gap-1 mb-1.5">
                  <span className="text-xs text-dark-300 font-medium">
                    {row.name || `${t('vegMap.rowDefault')} ${rowIdx + 1}`}
                  </span>
                  <span className="text-[10px] text-dark-500">{rowCellCount}/{rowTotalSpots}</span>
                  {editMode && (
                    <>
                      <button type="button" onClick={() => handleFillRow(rowIdx)}
                        className="text-[9px] px-1 py-0.5 rounded text-dark-500 hover:text-dark-300 hover:bg-dark-700 transition"
                        title={t('vegMap.fillRow')}>&#9635;</button>
                      <button type="button" onClick={() => handleClearRow(rowIdx)}
                        className="text-[9px] px-1 py-0.5 rounded text-dark-500 hover:text-red-400 hover:bg-dark-700 transition"
                        title={t('vegMap.clearRow')}>&#10005;</button>
                    </>
                  )}
                </div>

                {/* Tables stacked vertically with gaps */}
                <div className="flex flex-col gap-2">
                  {tables.map(table => renderTable(table, editMode))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      {batches.length > 0 && !editMode && (
        <div className="flex flex-wrap gap-3 text-xs">
          {batches.map((b, idx) => {
            const color = STRAIN_COLORS[idx % STRAIN_COLORS.length];
            const placed = batchCellCounts[b._id] || 0;
            const goodCount = batchGoodCountMap[b._id] || 0;
            if (placed === 0 && goodCount === 0) return null;
            const unplaced = goodCount - placed;
            return (
              <div key={b._id} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                <span className="text-dark-300">{b.name || '—'}</span>
                <span className="text-dark-500">{placed}/{goodCount}</span>
                {unplaced > 0 && (
                  <span className="text-amber-400">(+{unplaced} {t('vegMap.unplaced')})</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
