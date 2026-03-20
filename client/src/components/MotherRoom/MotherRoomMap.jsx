import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import MotherPlantCell, { HEALTH_COLORS } from './MotherPlantCell';

const DEFAULT_DEAD_SPOTS = [2];

export default function MotherRoomMap({ mapData, plants, onSave, saving, onPlantClick }) {
  const { t } = useTranslation();

  const [motherRows, setMotherRows] = useState(
    mapData?.motherRows?.length > 0 ? mapData.motherRows : []
  );
  const [plantPositions, setPlantPositions] = useState(mapData?.plantPositions || []);
  const [editMode, setEditMode] = useState(false);
  const [showSetup, setShowSetup] = useState((mapData?.motherRows || []).length === 0);
  const [activePlantId, setActivePlantId] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Setup state
  const [setupRows, setSetupRows] = useState(
    motherRows.length > 0
      ? motherRows.map(r => ({ ...r, deadSpots: r.deadSpots || [] }))
      : [{ name: `${t('motherRoom.rowDefault', 'Ряд')} 1`, tablesCount: 4, plantsPerTable: 20, tableCols: 5, tableRows: 4, deadSpots: DEFAULT_DEAD_SPOTS }]
  );

  // Flat table list
  const flatTables = useMemo(() => {
    const tables = [];
    motherRows.forEach((row, rowIdx) => {
      for (let ti = 0; ti < row.tablesCount; ti++) {
        tables.push({
          rowIdx,
          tableInRow: ti,
          flatIdx: tables.length,
          rowName: row.name,
          plantsPerTable: row.plantsPerTable,
          tableCols: row.tableCols || 5,
          tableRows: row.tableRows || 4,
          deadSpots: new Set(row.deadSpots || [])
        });
      }
    });
    return tables;
  }, [motherRows]);

  // Build plant lookup maps
  const plantMap = useMemo(() => {
    const m = {};
    plants.forEach(p => { m[p._id] = p; });
    return m;
  }, [plants]);

  // Set of already-placed plant IDs
  const placedPlantIds = useMemo(() => {
    const s = new Set();
    plantPositions.forEach(p => {
      const id = typeof p.plantId === 'object' ? (p.plantId?._id || p.plantId) : p.plantId;
      s.add(String(id));
    });
    return s;
  }, [plantPositions]);

  const positionMap = useMemo(() => {
    const m = {};
    plantPositions.forEach(p => {
      const pid = typeof p.plantId === 'object' ? (p.plantId?._id || p.plantId) : p.plantId;
      m[`${p.row}:${p.position}`] = String(pid);
    });
    return m;
  }, [plantPositions]);

  const totalSpots = useMemo(() => {
    return motherRows.reduce((s, r) => s + r.tablesCount * r.plantsPerTable, 0);
  }, [motherRows]);

  // Setup handlers
  const calcPlants = (cols, rows, deadSpots) => cols * rows - (deadSpots?.length || 0);

  const updateSetupRow = (idx, field, value) => {
    setSetupRows(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const addSetupRow = () => {
    setSetupRows(prev => [...prev, {
      name: `${t('motherRoom.rowDefault', 'Ряд')} ${prev.length + 1}`,
      tablesCount: 4, plantsPerTable: 20, tableCols: 5, tableRows: 4,
      deadSpots: DEFAULT_DEAD_SPOTS
    }]);
  };

  const removeSetupRow = (idx) => {
    if (setupRows.length <= 1) return;
    setSetupRows(prev => prev.filter((_, i) => i !== idx));
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
    const cleaned = plantPositions.filter(p => {
      if (p.row >= totalNewTables) return false;
      let remaining = p.row;
      for (const r of newRows) {
        if (remaining < r.tablesCount) {
          return p.position < r.plantsPerTable;
        }
        remaining -= r.tablesCount;
      }
      return false;
    });
    setMotherRows(newRows);
    setPlantPositions(cleaned);
    setShowSetup(false);
  };

  const handleCellClick = useCallback((flatTableIdx, posIdx) => {
    if (!editMode) {
      // In view mode, click opens plant detail
      const plantId = positionMap[`${flatTableIdx}:${posIdx}`];
      if (plantId && onPlantClick) onPlantClick(plantId);
      return;
    }
    const key = `${flatTableIdx}:${posIdx}`;
    const existing = positionMap[key];
    if (existing) {
      // Remove
      setPlantPositions(prev => prev.filter(p => !(p.row === flatTableIdx && p.position === posIdx)));
    } else if (activePlantId && !placedPlantIds.has(activePlantId)) {
      // Place (each plant can only be placed once)
      setPlantPositions(prev => [...prev, { row: flatTableIdx, position: posIdx, plantId: activePlantId }]);
      setActivePlantId(null);
    }
  }, [editMode, positionMap, activePlantId, placedPlantIds, onPlantClick]);

  const handleClearTable = (flatTableIdx) => {
    setPlantPositions(prev => prev.filter(p => p.row !== flatTableIdx));
  };

  const handleClearRow = (rowIdx) => {
    const tablesInRow = flatTables.filter(t => t.rowIdx === rowIdx);
    const flatIdxs = new Set(tablesInRow.map(t => t.flatIdx));
    setPlantPositions(prev => prev.filter(p => !flatIdxs.has(p.row)));
  };

  const handleClearAll = () => {
    setPlantPositions([]);
    setActivePlantId(null);
  };

  const handleSave = async () => {
    const normalized = plantPositions.map(p => ({
      row: p.row,
      position: p.position,
      plantId: typeof p.plantId === 'object' ? (p.plantId?._id || p.plantId) : p.plantId
    }));
    await onSave({ motherRows, plantPositions: normalized });
    setEditMode(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleCancel = () => {
    setEditMode(false);
    setMotherRows(mapData?.motherRows?.length > 0 ? mapData.motherRows : []);
    setPlantPositions(mapData?.plantPositions || []);
    setActivePlantId(null);
  };

  const hasGrid = motherRows.length > 0;

  // ==================== SETUP SCREEN ====================
  if (showSetup || !hasGrid) {
    const setupTotalTables = setupRows.reduce((s, r) => s + (r.tablesCount || 0), 0);
    const setupTotalSpots = setupRows.reduce((s, r) => s + (r.tablesCount || 0) * calcPlants(r.tableCols, r.tableRows, r.deadSpots), 0);

    return (
      <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 space-y-4">
        <h3 className="text-white font-semibold text-sm">{t('motherRoom.setupTitle')}</h3>

        <div className="space-y-3">
          {setupRows.map((row, idx) => {
            const deadSet = new Set(row.deadSpots || []);
            const plantsCount = calcPlants(row.tableCols, row.tableRows, row.deadSpots);

            return (
              <div key={idx} className="bg-dark-700/30 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.name}
                    onChange={e => updateSetupRow(idx, 'name', e.target.value)}
                    placeholder={`${t('motherRoom.rowDefault', 'Ряд')} ${idx + 1}`}
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
                        updateSetupRow(idx, 'plantsPerTable', calcPlants(v, row.tableRows, row.deadSpots));
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
                        updateSetupRow(idx, 'plantsPerTable', calcPlants(row.tableCols, v, row.deadSpots));
                      }}
                      className="w-12 bg-dark-700 border border-dark-600 rounded px-1.5 py-1 text-white text-xs text-center"
                    />
                  </div>
                  <span className="text-dark-500">
                    = <span className="text-white font-medium">{plantsCount}</span> {t('vegMap.plantsWord')} × {row.tablesCount} = <span className="text-white font-medium">{plantsCount * (row.tablesCount || 0)}</span>
                  </span>
                </div>

                {/* Dead spot preview */}
                <div className="space-y-1">
                  <span className="text-[10px] text-dark-500">{t('vegMap.deadSpotsLabel')} ({(row.deadSpots || []).length})</span>
                  <div className="inline-flex flex-col gap-px bg-dark-800/50 rounded p-1">
                    {Array.from({ length: Math.min(row.tableRows || 4, 3) }, (_, r) => (
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
                    {(row.tableRows || 4) > 3 && (
                      <div className="text-[8px] text-dark-600 text-center">...{(row.tableRows || 4) - 3} {t('vegMap.moreRows')}</div>
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
  const tablesByRow = motherRows.map((row, rowIdx) => ({
    row,
    rowIdx,
    tables: flatTables.filter(t => t.rowIdx === rowIdx)
  }));

  const unplacedPlants = plants.filter(p => !p.retiredAt && !placedPlantIds.has(p._id));

  const renderTable = (table) => {
    const { flatIdx, plantsPerTable, tableCols, tableRows: tRows, deadSpots } = table;
    const tableCellCount = plantPositions.filter(p => p.row === flatIdx).length;

    let posCounter = 0;
    const gridToPosMap = {};
    for (let gi = 0; gi < tableCols * tRows; gi++) {
      if (!deadSpots.has(gi)) {
        gridToPosMap[gi] = posCounter++;
      }
    }

    return (
      <div key={flatIdx} className="flex flex-col items-center shrink-0">
        <div className="flex items-center gap-0.5 mb-0.5">
          <span className="text-[9px] text-dark-500 font-medium">{table.tableInRow + 1}</span>
          {editMode && (
            <button type="button" onClick={() => handleClearTable(flatIdx)}
              className="text-[8px] px-0.5 rounded text-dark-600 hover:text-red-400 hover:bg-dark-700 transition"
              title={t('vegMap.clearTable')}>&#10005;</button>
          )}
        </div>

        <div className="flex flex-col" style={{ gap: '1px' }}>
          {Array.from({ length: tRows }, (_, rowInTable) => (
            <div key={rowInTable} className="flex" style={{ gap: '1px' }}>
              {Array.from({ length: tableCols }, (_, colIdx) => {
                const gridIdx = rowInTable * tableCols + colIdx;
                const isDead = deadSpots.has(gridIdx);
                if (isDead) return <div key={colIdx} className="w-[18px] h-[18px] sm:w-[20px] sm:h-[20px]" />;

                const posIdx = gridToPosMap[gridIdx];
                const plantId = positionMap[`${flatIdx}:${posIdx}`];
                const plant = plantId ? plantMap[plantId] : null;
                // Also check populated data from backend
                const plantData = plant || (plantId ? plantPositions.find(p => {
                  const pid = typeof p.plantId === 'object' ? p.plantId?._id : p.plantId;
                  return String(pid) === plantId;
                })?.plantId : null);
                const name = typeof plantData === 'object' ? plantData?.name : null;
                const strain = typeof plantData === 'object' ? plantData?.strain : null;
                const health = typeof plantData === 'object' ? plantData?.health : 'good';

                return (
                  <MotherPlantCell
                    key={colIdx}
                    plantName={name}
                    strainLabel={strain}
                    health={health}
                    isEmpty={!plantId}
                    isActive={editMode && !!activePlantId && !plantId}
                    onClick={() => handleCellClick(flatIdx, posIdx)}
                    micro
                  />
                );
              })}
            </div>
          ))}
        </div>

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
          {t('motherRoom.mapTitle')}
          <span className="text-dark-400 font-normal ml-2">
            {assignedCount}/{totalSpots} {t('motherRoom.spotsUsed')}
          </span>
        </h4>
        <div className="flex gap-2 flex-wrap">
          {editMode ? (
            <>
              <button type="button" onClick={handleClearAll}
                className="px-2 py-1 text-xs bg-dark-700 text-red-400 rounded hover:bg-dark-600 transition">{t('vegMap.clear')}</button>
              <button type="button" onClick={() => setShowSetup(true)}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition">{t('motherRoom.setupBtn')}</button>
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
              <button type="button" onClick={() => { setSetupRows(motherRows.map(r => ({ ...r, deadSpots: r.deadSpots || [] }))); setShowSetup(true); }}
                className="px-2 py-1 text-xs bg-dark-700 text-dark-300 rounded hover:bg-dark-600 transition">{t('motherRoom.setupBtn')}</button>
            </>
          )}
        </div>
      </div>

      {saveSuccess && (
        <div className="bg-green-900/30 border border-green-800 text-green-400 px-3 py-2 rounded-lg text-xs flex items-center justify-between">
          <span>{t('motherRoom.mapSaved')}</span>
          <button type="button" onClick={() => setSaveSuccess(false)} className="text-green-500 hover:text-green-300 ml-2">&#10005;</button>
        </div>
      )}

      {/* Plant palette (edit mode) */}
      {editMode && (
        <div className="bg-dark-700/50 border border-dark-600 rounded-lg p-3">
          <div className="text-xs text-dark-400 mb-2">{t('motherRoom.selectPlant')}</div>
          <div className="flex flex-wrap gap-2">
            {unplacedPlants.map(p => {
              const color = HEALTH_COLORS[p.health] || HEALTH_COLORS.good;
              const isActive = activePlantId === p._id;
              return (
                <button key={p._id} type="button"
                  onClick={() => setActivePlantId(isActive ? null : p._id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${color.bg} ${color.border} ${color.text} ${
                    isActive ? 'ring-2 ring-white scale-105' : 'hover:brightness-125'
                  }`}>
                  {p.name}
                  {p.strain && <span className="ml-1 opacity-60">{p.strain}</span>}
                </button>
              );
            })}
            {unplacedPlants.length === 0 && (
              <span className="text-xs text-dark-500">{t('motherRoom.noActivePlants')}</span>
            )}
          </div>
          {unplacedPlants.length > 0 && (
            <div className="text-[10px] text-dark-500 mt-1.5">
              {unplacedPlants.length} {t('motherRoom.unplaced')}
            </div>
          )}
        </div>
      )}

      {/* Map */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-4 min-w-min">
          {tablesByRow.map(({ row, rowIdx, tables }) => {
            const rowCellCount = tables.reduce((s, t) =>
              s + plantPositions.filter(p => p.row === t.flatIdx).length, 0);
            const rowTotalSpots = row.tablesCount * row.plantsPerTable;

            return (
              <div key={rowIdx} className="flex flex-col items-center shrink-0">
                <div className="flex items-center gap-1 mb-1.5">
                  <span className="text-xs text-dark-300 font-medium">
                    {row.name || `${t('motherRoom.rowDefault', 'Ряд')} ${rowIdx + 1}`}
                  </span>
                  <span className="text-[10px] text-dark-500">{rowCellCount}/{rowTotalSpots}</span>
                  {editMode && (
                    <button type="button" onClick={() => handleClearRow(rowIdx)}
                      className="text-[9px] px-1 py-0.5 rounded text-dark-500 hover:text-red-400 hover:bg-dark-700 transition"
                      title={t('vegMap.clearRow')}>&#10005;</button>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {tables.map(table => renderTable(table))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Health legend */}
      {!editMode && assignedCount > 0 && (
        <div className="flex flex-wrap gap-3 text-xs">
          {Object.entries(HEALTH_COLORS).map(([key, color]) => {
            const count = Object.values(positionMap).filter(pid => {
              const p = plantMap[pid];
              return p && p.health === key;
            }).length;
            if (count === 0) return null;
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                <span className="text-dark-300">{t(`motherRoom.health${key.charAt(0).toUpperCase() + key.slice(1)}`)}</span>
                <span className="text-dark-500">{count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
