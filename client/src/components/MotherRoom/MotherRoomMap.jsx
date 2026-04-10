import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import MotherPlantCell, { HEALTH_COLORS } from './MotherPlantCell';
import StrainSelect from '../StrainSelect';

const DEFAULT_DEAD_SPOTS = [2];

function daysAgo(date) {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

function serializeDragPayload(payload) {
  return JSON.stringify(payload);
}

function parseDragPayload(e) {
  try {
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function MotherRoomMap({
  mapData,
  plants,
  canManage,
  onAutoSave,
  onQuickCreate,
  onPlantEdit,
  onPlantPrune,
  onPlantRetire,
  onPlantDelete,
  saveStatus, // 'idle' | 'saving' | 'saved' | 'error'
  showSetupProp,
  onCloseSetup,
}) {
  const { t } = useTranslation();

  const [motherRows, setMotherRows] = useState(
    mapData?.motherRows?.length > 0 ? mapData.motherRows : []
  );
  const [plantPositions, setPlantPositions] = useState(mapData?.plantPositions || []);

  // Re-sync when mapData changes from parent (e.g. after reload)
  useEffect(() => {
    setMotherRows(mapData?.motherRows?.length > 0 ? mapData.motherRows : []);
    setPlantPositions(mapData?.plantPositions || []);
  }, [mapData]);

  const [showSetup, setShowSetup] = useState(
    showSetupProp || (mapData?.motherRows || []).length === 0
  );

  useEffect(() => {
    if (showSetupProp) setShowSetup(true);
  }, [showSetupProp]);

  // Touch fallback: click-to-select from palette, then click empty cell to place
  const [activePlantId, setActivePlantId] = useState(null);

  // Drag state
  const [dragging, setDragging] = useState(null); // { plantId, from: 'palette' | {row, position} }
  const [dropTarget, setDropTarget] = useState(null); // 'palette' | {row, position}

  // Popover state
  const [popover, setPopover] = useState(null);
  // { cellKey: 'r:p', rect: DOMRect, plantId: string|null }

  // Setup state (for setup screen)
  const [setupRows, setSetupRows] = useState(
    (mapData?.motherRows?.length > 0 ? mapData.motherRows : [])
      .map(r => ({ ...r, deadSpots: r.deadSpots || [] }))
  );
  useEffect(() => {
    if (showSetup) {
      setSetupRows(
        motherRows.length > 0
          ? motherRows.map(r => ({ ...r, deadSpots: r.deadSpots || [] }))
          : [{
              name: `${t('motherRoom.rowDefault', 'Ряд')} 1`,
              tablesCount: 4,
              plantsPerTable: 20,
              tableCols: 5,
              tableRows: 4,
              deadSpots: DEFAULT_DEAD_SPOTS,
            }]
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSetup]);

  // Autosave debounce
  const saveTimer = useRef(null);
  const scheduleSave = useCallback((newRows, newPositions) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const normalized = newPositions.map(p => ({
        row: p.row,
        position: p.position,
        plantId: typeof p.plantId === 'object' ? (p.plantId?._id || p.plantId) : p.plantId,
      }));
      onAutoSave?.({ motherRows: newRows, plantPositions: normalized });
    }, 500);
  }, [onAutoSave]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

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
          deadSpots: new Set(row.deadSpots || []),
        });
      }
    });
    return tables;
  }, [motherRows]);

  const plantMap = useMemo(() => {
    const m = {};
    plants.forEach(p => { m[p._id] = p; });
    return m;
  }, [plants]);

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

  const totalSpots = useMemo(
    () => motherRows.reduce((s, r) => s + r.tablesCount * r.plantsPerTable, 0),
    [motherRows]
  );

  const unplacedPlants = plants.filter(p => !p.retiredAt && !placedPlantIds.has(p._id));

  // ============ DRAG & DROP HANDLERS ============

  const handlePaletteDragStart = (e, plantId) => {
    if (!canManage) return;
    setDragging({ plantId, from: 'palette' });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', serializeDragPayload({ type: 'palette', plantId }));
  };

  const handleCellDragStart = (e, row, position, plantId) => {
    if (!canManage) return;
    e.stopPropagation();
    setDragging({ plantId, from: { row, position } });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', serializeDragPayload({ type: 'cell', plantId, fromRow: row, fromPos: position }));
  };

  const handleDragEnd = () => {
    setDragging(null);
    setDropTarget(null);
  };

  const handleCellDragOver = (e, row, position) => {
    if (!canManage || !dragging) return;
    // Only accept drop on empty cell
    const key = `${row}:${position}`;
    if (positionMap[key]) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ row, position });
  };

  const handleCellDragLeave = () => {
    setDropTarget(null);
  };

  const handleCellDrop = (e, row, position) => {
    if (!canManage) return;
    e.preventDefault();
    e.stopPropagation();
    const payload = parseDragPayload(e) || dragging;
    if (!payload) return;
    const key = `${row}:${position}`;
    if (positionMap[key]) {
      // Occupied — ignore
      setDropTarget(null);
      setDragging(null);
      return;
    }
    const plantId = typeof payload.plantId === 'object' ? (payload.plantId?._id || payload.plantId) : payload.plantId;

    let newPositions;
    if (payload.type === 'cell' || (payload.from && typeof payload.from === 'object')) {
      const fromRow = payload.fromRow ?? payload.from.row;
      const fromPos = payload.fromPos ?? payload.from.position;
      newPositions = plantPositions
        .filter(p => !(p.row === fromRow && p.position === fromPos))
        .concat([{ row, position, plantId }]);
    } else {
      newPositions = [...plantPositions, { row, position, plantId }];
    }
    setPlantPositions(newPositions);
    scheduleSave(motherRows, newPositions);
    setDropTarget(null);
    setDragging(null);
    setActivePlantId(null);
  };

  const handlePaletteDragOver = (e) => {
    if (!canManage || !dragging) return;
    // Only accept drop from cells (unplace)
    if (dragging.from === 'palette') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget('palette');
  };

  const handlePaletteDrop = (e) => {
    if (!canManage) return;
    e.preventDefault();
    const payload = parseDragPayload(e) || dragging;
    if (!payload) return;
    if (payload.type !== 'cell' && !(payload.from && typeof payload.from === 'object')) {
      setDropTarget(null);
      setDragging(null);
      return;
    }
    const fromRow = payload.fromRow ?? payload.from.row;
    const fromPos = payload.fromPos ?? payload.from.position;
    const newPositions = plantPositions.filter(p => !(p.row === fromRow && p.position === fromPos));
    setPlantPositions(newPositions);
    scheduleSave(motherRows, newPositions);
    setDropTarget(null);
    setDragging(null);
  };

  // ============ CLICK HANDLERS (fallback & popover) ============

  const handleCellClick = (e, row, position) => {
    if (!canManage) {
      // View-only: if there's a plant, open detail popover read-only
      const key = `${row}:${position}`;
      const plantId = positionMap[key];
      if (plantId) {
        setPopover({ cellKey: key, rect: e.currentTarget.getBoundingClientRect(), plantId });
      }
      return;
    }
    const key = `${row}:${position}`;
    const plantId = positionMap[key];

    if (plantId) {
      // Occupied — open plant detail popover
      setPopover({ cellKey: key, rect: e.currentTarget.getBoundingClientRect(), plantId });
      return;
    }

    // Empty cell
    if (activePlantId && !placedPlantIds.has(activePlantId)) {
      // Touch fallback: place selected palette plant
      const newPositions = [...plantPositions, { row, position, plantId: activePlantId }];
      setPlantPositions(newPositions);
      scheduleSave(motherRows, newPositions);
      setActivePlantId(null);
      return;
    }

    // Open quick-create popover
    setPopover({ cellKey: key, rect: e.currentTarget.getBoundingClientRect(), plantId: null });
  };

  const handlePaletteChipClick = (plantId) => {
    if (!canManage) return;
    setActivePlantId(prev => prev === plantId ? null : plantId);
  };

  const closePopover = useCallback(() => setPopover(null), []);

  // Close popover on outside click / Esc
  useEffect(() => {
    if (!popover) return;
    const onKey = (e) => { if (e.key === 'Escape') closePopover(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popover, closePopover]);

  // ============ POPOVER ACTIONS ============

  const handleQuickCreateSubmit = async (form) => {
    if (!popover || popover.plantId) return;
    const [row, position] = popover.cellKey.split(':').map(Number);
    const created = await onQuickCreate({ name: form.name.trim(), strain: form.strain });
    if (created) {
      const newPositions = [...plantPositions, { row, position, plantId: created._id }];
      setPlantPositions(newPositions);
      scheduleSave(motherRows, newPositions);
    }
    closePopover();
  };

  const handleRemoveFromMap = () => {
    if (!popover?.cellKey) return;
    const [row, position] = popover.cellKey.split(':').map(Number);
    const newPositions = plantPositions.filter(p => !(p.row === row && p.position === position));
    setPlantPositions(newPositions);
    scheduleSave(motherRows, newPositions);
    closePopover();
  };

  const handlePopoverEdit = () => {
    if (popover?.plantId) onPlantEdit?.(popover.plantId);
    closePopover();
  };
  const handlePopoverPrune = () => {
    if (popover?.plantId) onPlantPrune?.(popover.plantId);
    closePopover();
  };
  const handlePopoverRetire = () => {
    if (popover?.plantId) onPlantRetire?.(popover.plantId);
    closePopover();
  };
  const handlePopoverDelete = async () => {
    if (!popover?.plantId) return;
    const ok = await onPlantDelete?.(popover.plantId);
    if (ok) {
      // Remove from positions too
      const [row, position] = popover.cellKey.split(':').map(Number);
      const newPositions = plantPositions.filter(p => !(p.row === row && p.position === position));
      setPlantPositions(newPositions);
      scheduleSave(motherRows, newPositions);
    }
    closePopover();
  };

  // ============ SETUP HANDLERS ============

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
      tablesCount: 4,
      plantsPerTable: 20,
      tableCols: 5,
      tableRows: 4,
      deadSpots: DEFAULT_DEAD_SPOTS,
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
      deadSpots: r.deadSpots || [],
    }));
    const totalNewTables = newRows.reduce((s, r) => s + r.tablesCount, 0);
    const cleaned = plantPositions.filter(p => {
      if (p.row >= totalNewTables) return false;
      let remaining = p.row;
      for (const r of newRows) {
        if (remaining < r.tablesCount) return p.position < r.plantsPerTable;
        remaining -= r.tablesCount;
      }
      return false;
    });
    setMotherRows(newRows);
    setPlantPositions(cleaned);
    scheduleSave(newRows, cleaned);
    setShowSetup(false);
    onCloseSetup?.();
  };

  const handleCancelSetup = () => {
    setShowSetup(false);
    onCloseSetup?.();
  };

  const hasGrid = motherRows.length > 0;

  // ============ RENDER: SETUP SCREEN ============
  if (showSetup || !hasGrid) {
    const setupTotalTables = setupRows.reduce((s, r) => s + (r.tablesCount || 0), 0);
    const setupTotalSpots = setupRows.reduce(
      (s, r) => s + (r.tablesCount || 0) * calcPlants(r.tableCols, r.tableRows, r.deadSpots),
      0
    );

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
            <button type="button" onClick={handleCancelSetup}
              className="px-4 py-2 text-dark-400 hover:text-dark-200 text-sm transition">
              {t('common.cancel')}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ============ RENDER: MAP VIEW ============
  const assignedCount = Object.keys(positionMap).length;
  const tablesByRow = motherRows.map((row, rowIdx) => ({
    row,
    rowIdx,
    tables: flatTables.filter(tbl => tbl.rowIdx === rowIdx),
  }));

  const renderTable = (table) => {
    const { flatIdx, tableCols, tableRows: tRows, deadSpots } = table;

    let posCounter = 0;
    const gridToPosMap = {};
    for (let gi = 0; gi < tableCols * tRows; gi++) {
      if (!deadSpots.has(gi)) {
        gridToPosMap[gi] = posCounter++;
      }
    }

    return (
      <div key={flatIdx} className="flex flex-col items-center shrink-0">
        <span className="text-[10px] text-dark-500 font-medium mb-0.5">{table.tableInRow + 1}</span>

        <div className="flex flex-col" style={{ gap: '2px' }}>
          {Array.from({ length: tRows }, (_, rowInTable) => (
            <div key={rowInTable} className="flex" style={{ gap: '2px' }}>
              {Array.from({ length: tableCols }, (_, colIdx) => {
                const gridIdx = rowInTable * tableCols + colIdx;
                const isDead = deadSpots.has(gridIdx);
                if (isDead) return <div key={colIdx} className="w-[22px] h-[22px] sm:w-[26px] sm:h-[26px]" />;

                const posIdx = gridToPosMap[gridIdx];
                const key = `${flatIdx}:${posIdx}`;
                const plantId = positionMap[key];
                const plant = plantId ? plantMap[plantId] : null;

                const isDragSource = dragging && dragging.plantId === plantId && dragging.from && dragging.from.row === flatIdx && dragging.from.position === posIdx;
                const isThisDropTarget = dropTarget && typeof dropTarget === 'object' && dropTarget.row === flatIdx && dropTarget.position === posIdx;

                return (
                  <MotherPlantCell
                    key={colIdx}
                    plantName={plant?.name}
                    strainLabel={plant?.strain}
                    health={plant?.health || 'good'}
                    isEmpty={!plantId}
                    isActive={!plantId && !!activePlantId}
                    isDragging={isDragSource}
                    isDropTarget={isThisDropTarget}
                    draggable={!!plantId && canManage}
                    onClick={(e) => handleCellClick(e, flatIdx, posIdx)}
                    onDragStart={plantId ? (e) => handleCellDragStart(e, flatIdx, posIdx, plantId) : undefined}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleCellDragOver(e, flatIdx, posIdx)}
                    onDragLeave={handleCellDragLeave}
                    onDrop={(e) => handleCellDrop(e, flatIdx, posIdx)}
                    micro
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderPopover = () => {
    if (!popover) return null;

    // Smart positioning: prefer below-right of cell, flip if not enough space
    const POPOVER_W = 280;
    const POPOVER_H = 200; // rough estimate
    const MARGIN = 8;
    const rect = popover.rect;
    let left = rect.left + rect.width / 2 - POPOVER_W / 2;
    let top = rect.bottom + MARGIN;
    if (left + POPOVER_W > window.innerWidth - MARGIN) {
      left = window.innerWidth - POPOVER_W - MARGIN;
    }
    if (left < MARGIN) left = MARGIN;
    if (top + POPOVER_H > window.innerHeight - MARGIN) {
      top = rect.top - POPOVER_H - MARGIN;
      if (top < MARGIN) top = MARGIN;
    }

    const isEmpty = !popover.plantId;

    return (
      <>
        <div className="fixed inset-0 z-40" onClick={closePopover} />
        <div
          className="fixed z-50 bg-dark-800 border border-dark-600 rounded-lg shadow-2xl p-3"
          style={{ left, top, width: POPOVER_W }}
          onClick={e => e.stopPropagation()}
        >
          {isEmpty ? (
            <QuickCreateForm
              onSubmit={handleQuickCreateSubmit}
              onCancel={closePopover}
              t={t}
            />
          ) : (
            <PlantDetailCard
              plant={plantMap[popover.plantId]}
              canManage={canManage}
              onEdit={handlePopoverEdit}
              onPrune={handlePopoverPrune}
              onRetire={handlePopoverRetire}
              onDelete={handlePopoverDelete}
              onRemoveFromMap={handleRemoveFromMap}
              t={t}
            />
          )}
        </div>
      </>
    );
  };

  return (
    <div className="space-y-3">
      {/* Palette */}
      <div
        onDragOver={handlePaletteDragOver}
        onDrop={handlePaletteDrop}
        className={`bg-dark-700/40 border rounded-lg p-3 transition ${
          dropTarget === 'palette' ? 'border-primary-400 ring-1 ring-primary-400 bg-primary-500/10' : 'border-dark-600'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-dark-400">
            {t('motherRoom.unplaced')} ({unplacedPlants.length})
          </span>
          {dragging && dragging.from !== 'palette' && (
            <span className="text-[10px] text-primary-400">{t('motherRoom.dropHereToUnplace')}</span>
          )}
        </div>
        {unplacedPlants.length === 0 ? (
          <div className="text-xs text-dark-500 py-1">
            {dragging && dragging.from !== 'palette'
              ? t('motherRoom.dropHereToUnplace')
              : t('motherRoom.noActivePlants')}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {unplacedPlants.map(p => {
              const color = HEALTH_COLORS[p.health] || HEALTH_COLORS.good;
              const isActive = activePlantId === p._id;
              const isDragSource = dragging && dragging.plantId === p._id && dragging.from === 'palette';
              return (
                <div
                  key={p._id}
                  draggable={canManage}
                  onDragStart={(e) => handlePaletteDragStart(e, p._id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => handlePaletteChipClick(p._id)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium border select-none transition ${color.bg} ${color.border} ${color.text} ${
                    canManage ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
                  } ${isActive ? 'ring-2 ring-white scale-105' : 'hover:brightness-125'} ${isDragSource ? 'opacity-40' : ''}`}
                  title={p.strain || ''}
                >
                  {p.name}
                  {p.strain && <span className="ml-1 opacity-60">{p.strain}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Header row: title + spots count */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-medium text-white">
          {t('motherRoom.mapTitle')}
          <span className="text-dark-400 font-normal ml-2">
            {assignedCount}/{totalSpots} {t('motherRoom.spotsUsed')}
          </span>
        </h4>
      </div>

      {/* Map: ряды стекаются вертикально, столы в ряду идут горизонтально */}
      <div className="flex flex-col gap-5 pb-2">
        {tablesByRow.map(({ row, rowIdx, tables }) => {
          const rowCellCount = tables.reduce(
            (s, tbl) => s + plantPositions.filter(p => p.row === tbl.flatIdx).length,
            0
          );
          const rowTotalSpots = row.tablesCount * row.plantsPerTable;

          return (
            <div key={rowIdx} className="flex flex-col">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs text-dark-300 font-medium">
                  {row.name || `${t('motherRoom.rowDefault', 'Ряд')} ${rowIdx + 1}`}
                </span>
                <span className="text-[10px] text-dark-500">{rowCellCount}/{rowTotalSpots}</span>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {tables.map(table => renderTable(table))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Health legend */}
      {assignedCount > 0 && (
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

      {renderPopover()}
    </div>
  );
}

// ============ POPOVER CONTENT COMPONENTS ============

function QuickCreateForm({ onSubmit, onCancel, t }) {
  const [name, setName] = useState('');
  const [strain, setStrain] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit({ name, strain });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-white text-sm font-semibold">{t('motherRoom.quickCreate')}</div>
      <input
        type="text"
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        placeholder={t('motherRoom.plantName')}
        className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-white text-sm"
      />
      <StrainSelect value={strain} onChange={setStrain} className="w-full" />
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim() || busy}
          className="flex-1 px-3 py-1.5 text-xs bg-primary-600 text-white rounded hover:bg-primary-500 disabled:opacity-50 transition"
        >
          {busy ? '...' : t('motherRoom.createAndPlace')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-dark-400 hover:text-white transition"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

function PlantDetailCard({ plant, canManage, onEdit, onPrune, onRetire, onDelete, onRemoveFromMap, t }) {
  if (!plant) return <div className="text-dark-400 text-sm">—</div>;
  const color = HEALTH_COLORS[plant.health] || HEALTH_COLORS.good;
  const age = daysAgo(plant.plantedDate);
  const lastPrune = daysAgo(plant.lastPruneDate);

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-white text-sm font-semibold truncate">{plant.name}</div>
          {plant.strain && <div className="text-dark-400 text-xs truncate">{plant.strain}</div>}
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${color.bg} ${color.border} ${color.text} border shrink-0`}>
          {t(`motherRoom.health${(plant.health || 'good').charAt(0).toUpperCase() + (plant.health || 'good').slice(1)}`)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1 text-[11px]">
        <div>
          <span className="text-dark-500">{t('motherRoom.age')}:</span>{' '}
          <span className="text-white">{age != null ? `${age} ${t('motherRoom.ageDays')}` : '—'}</span>
        </div>
        <div>
          <span className="text-dark-500">{t('motherRoom.lastPrune')}:</span>{' '}
          <span className="text-white">
            {lastPrune != null ? `${lastPrune} ${t('motherRoom.daysAgo')}` : t('motherRoom.neverPruned')}
          </span>
        </div>
        {plant.pruneHistory?.length > 0 && (
          <div className="col-span-2">
            <span className="text-dark-500">{t('motherRoom.pruneHistory')}:</span>{' '}
            <span className="text-white">{plant.pruneHistory.length}x</span>
          </div>
        )}
      </div>

      {plant.notes && (
        <p className="text-dark-400 text-[11px] line-clamp-2 border-t border-dark-700 pt-1.5">{plant.notes}</p>
      )}

      {canManage && (
        <div className="flex flex-wrap gap-1 pt-1.5 border-t border-dark-700">
          <button type="button" onClick={onPrune}
            className="px-2 py-1 text-[11px] bg-green-600/20 text-green-400 border border-green-700/50 rounded hover:bg-green-600/30 transition">
            {t('motherRoom.recordPrune')}
          </button>
          <button type="button" onClick={onEdit}
            className="px-2 py-1 text-[11px] text-dark-300 hover:text-white hover:bg-dark-700 rounded transition">
            {t('common.edit')}
          </button>
          <button type="button" onClick={onRemoveFromMap}
            className="px-2 py-1 text-[11px] text-dark-300 hover:text-white hover:bg-dark-700 rounded transition">
            {t('motherRoom.removeFromMap')}
          </button>
          <button type="button" onClick={onRetire}
            className="px-2 py-1 text-[11px] text-amber-500 hover:text-amber-400 hover:bg-dark-700 rounded transition">
            {t('motherRoom.retire')}
          </button>
          <button type="button" onClick={onDelete}
            className="px-2 py-1 text-[11px] text-red-500 hover:text-red-400 hover:bg-dark-700 rounded transition ml-auto">
            {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  );
}
