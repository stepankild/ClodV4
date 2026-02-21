import { useState, useEffect, useMemo } from 'react';
import { roomService } from '../../services/roomService';
import { STRAIN_COLORS } from '../../components/RoomMap/PlantCell';

const formatDateShort = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

// ── Helpers ──
function getStrainForPlant(plantNumber, flowerStrains) {
  if (!flowerStrains || !plantNumber) return null;
  const idx = flowerStrains.findIndex(
    fs => plantNumber >= fs.startNumber && plantNumber <= fs.endNumber
  );
  if (idx === -1) return null;
  return { ...flowerStrains[idx], strainIndex: idx };
}

function migrateLayout(layout) {
  if (!layout) return { customRows: [], plantPositions: [] };
  if (layout.customRows?.length > 0) {
    const rows = layout.customRows.map(r => ({
      name: r.name || '', cols: r.cols || 4, rows: r.rows || 1,
      fillDirection: r.fillDirection || layout.fillDirection || 'topDown'
    }));
    return { customRows: rows, plantPositions: layout.plantPositions || [] };
  }
  return { customRows: [], plantPositions: [] };
}

// ── Sheet sizes ──
const SHEET_SIZES = [
  { name: 'Браслеты 8×10"', w: 203, h: 254, marginLR: 6.5, marginTB: 2, gap: 0, defaultCols: 10, defaultCount: 10 },
  { name: 'A4', w: 210, h: 297 },
  { name: 'A5', w: 148, h: 210 },
  { name: 'Letter', w: 216, h: 279 },
];

const DEFAULT_MARGIN = 5;
const DEFAULT_GAP = 2;

function calcFromSheet(sheetW, sheetH, cols, count, marginLR, marginTB, gap) {
  const mLR = marginLR ?? DEFAULT_MARGIN;
  const mTB = marginTB ?? DEFAULT_MARGIN;
  const g = gap ?? DEFAULT_GAP;
  const rows = Math.ceil(count / cols);
  const labelW = Math.floor((sheetW - mLR * 2 - g * (cols - 1)) / cols);
  const labelH = Math.floor((sheetH - mTB * 2 - g * (rows - 1)) / rows);
  return { labelW, labelH, rows, perPage: cols * rows, marginLR: mLR, marginTB: mTB, gap: g };
}

// ── Logo SVG → PNG data URL for PDF ──
function renderLogoToDataUrl(size = 64) {
  const svgStr = `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="32" cy="32" r="30" fill="#0d3320" stroke="#22c55e" stroke-width="2"/>
    <path d="M32 42 L32 26" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M32 30 Q22 22 18 14 Q24 16 32 26" fill="#16a34a" stroke="#22c55e" stroke-width="1"/>
    <path d="M32 28 Q40 18 46 12 Q40 16 32 24" fill="#16a34a" stroke="#22c55e" stroke-width="1"/>
    <path d="M32 26 Q28 14 32 8 Q36 14 32 26" fill="#22c55e" stroke="#15803d" stroke-width="0.8"/>
    <path d="M32 42 Q28 48 24 54" stroke="#a3a3a3" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
    <path d="M32 42 Q32 50 32 56" stroke="#a3a3a3" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
    <path d="M32 42 Q36 48 40 54" stroke="#a3a3a3" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
  </svg>`;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const img = new Image();
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve) => {
    img.onload = () => { ctx.drawImage(img, 0, 0, size, size); URL.revokeObjectURL(url); resolve(c.toDataURL('image/png')); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// ── PDF generation ──
async function generateLabelsPDF(room, plants, { cols, labelW, labelH, sheetW, sheetH, perPage, marginLR, marginTB, gap }) {
  const [{ jsPDF }, { RobotoRegular }, { RobotoBold }, JsBarcodeModule] = await Promise.all([
    import('jspdf'),
    import('../../fonts/Roboto-Regular'),
    import('../../fonts/Roboto-Bold'),
    import('jsbarcode')
  ]);
  const JsBarcode = JsBarcodeModule.default || JsBarcodeModule;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [sheetW, sheetH] });
  doc.addFileToVFS('Roboto-Regular.ttf', RobotoRegular);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.addFileToVFS('Roboto-Bold.ttf', RobotoBold);
  doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
  doc.setFont('Roboto', 'normal');
  const PAD = 2;
  const startDateStr = formatDateShort(room.startDate);
  const harvestDateStr = formatDateShort(room.expectedHarvestDate);
  // Вертикальный браслет: высота >> ширина (например 19x250мм)
  const isVertical = labelH > labelW * 3;
  const isCompact = labelH < 25;
  const isTiny = labelH < 18;

  // (logoDataUrl — убран, не используется на браслетах)

  for (let i = 0; i < plants.length; i++) {
    if (i > 0 && i % perPage === 0) doc.addPage();
    const idx = i % perPage;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const mLR = marginLR ?? DEFAULT_MARGIN;
    const mTB = marginTB ?? DEFAULT_MARGIN;
    const g = gap ?? DEFAULT_GAP;
    const x = mLR + col * (labelW + g);
    const y = mTB + row * (labelH + g);
    const plant = plants[i];

    // Dashed cutting border
    doc.setDrawColor(180, 180, 180);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.rect(x, y, labelW, labelH);
    doc.setLineDashPattern([], 0);

    // Barcode canvas
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, String(plant.number), {
      format: 'CODE128', width: 1.5, height: 30,
      displayValue: false, margin: 1
    });
    const barcodeDataUrl = canvas.toDataURL('image/png');

    if (isVertical) {
      // ── Вертикальный браслет (~19mm шир × ~250mm выс) ──
      // angle: -90 → текст идёт СВЕРХУ ВНИЗ (clockwise), совпадает с curY
      // Раскладка: #N → Комната → Сорт → Старт → Урожай → Штрихкод → #N

      const textX = x + labelW / 2 + 2; // центр браслета по ширине
      let curY = y + PAD + 5;

      // ─ 1. Номер куста — БОЛЬШОЙ ─
      doc.setFont('Roboto', 'bold'); doc.setFontSize(16); doc.setTextColor(20, 20, 20);
      const numLabel = `#${plant.number}`;
      doc.text(numLabel, textX, curY, { angle: -90 });
      curY += doc.getTextWidth(numLabel) + 10;

      // ─ 2. Комната ─
      doc.setFont('Roboto', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 20);
      const roomName = room.name || '—';
      doc.text(roomName, textX, curY, { angle: -90 });
      curY += doc.getTextWidth(roomName) + 6;

      // ─ 3. Сорт — БОЛЬШОЙ ─
      doc.setFont('Roboto', 'bold'); doc.setFontSize(11); doc.setTextColor(30, 30, 30);
      let st = plant.strain || room.strain || '—';
      const maxStLen = 60;
      if (doc.getTextWidth(st) > maxStLen) {
        while (doc.getTextWidth(st + '..') > maxStLen && st.length > 5) st = st.slice(0, -1);
        st += '..';
      }
      doc.text(st, textX, curY, { angle: -90 });
      curY += doc.getTextWidth(st) + 7;

      // ─ 4. Старт — отдельная строка ─
      doc.setFont('Roboto', 'bold'); doc.setFontSize(9); doc.setTextColor(40, 40, 40);
      const startStr = `Старт: ${startDateStr}`;
      doc.text(startStr, textX, curY, { angle: -90 });
      curY += doc.getTextWidth(startStr) + 4;

      // ─ 5. Урожай — отдельная строка ─
      const harvestStr = `Урожай: ${harvestDateStr}`;
      doc.text(harvestStr, textX, curY, { angle: -90 });
      curY += doc.getTextWidth(harvestStr) + 12;

      // ─ 6. Штрихкод — компактный (повёрнут на -90°) ─
      const srcCanvas = document.createElement('canvas');
      JsBarcode(srcCanvas, String(plant.number), {
        format: 'CODE128', width: 1.5, height: 30,
        displayValue: false, margin: 1
      });
      const rotCanvas = document.createElement('canvas');
      rotCanvas.width = srcCanvas.height;
      rotCanvas.height = srcCanvas.width;
      const rctx = rotCanvas.getContext('2d');
      rctx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
      rctx.rotate(-Math.PI / 2);
      rctx.drawImage(srcCanvas, -srcCanvas.width / 2, -srcCanvas.height / 2);
      const rotBarcodeUrl = rotCanvas.toDataURL('image/png');

      const barcodeW = labelW - PAD * 2 - 2;
      const barcodeH = Math.min(35, (y + labelH - curY) * 0.35);
      doc.addImage(rotBarcodeUrl, 'PNG', x + PAD + 1, curY, barcodeW, barcodeH);
      curY += barcodeH + 10;

      // ─ 7. Номер куста — дубль после штрихкода ─
      doc.setFont('Roboto', 'bold'); doc.setFontSize(14); doc.setTextColor(20, 20, 20);
      doc.text(numLabel, textX, curY, { angle: -90 });

    } else if (isTiny) {
      // Single-row: text left, barcode center, #N right (labelH < 18mm)
      const textY = y + labelH / 2 + 1;
      const barcodeW = Math.min(25, labelW * 0.2);
      const barcodeH = labelH - PAD * 2 - 2;
      const barcodeX = x + (labelW - barcodeW) / 2;

      doc.setFont('Roboto', 'bold'); doc.setFontSize(7); doc.setTextColor(30, 30, 30);
      doc.text(`${room.name}`, x + PAD, textY - 2);
      doc.setFont('Roboto', 'normal'); doc.setFontSize(5.5); doc.setTextColor(80, 80, 80);
      doc.text(`${plant.strain || room.strain || ''} | ${startDateStr}`, x + PAD, textY + 2);

      doc.addImage(barcodeDataUrl, 'PNG', barcodeX, y + PAD + 1, barcodeW, barcodeH);

      doc.setFont('Roboto', 'bold'); doc.setFontSize(10); doc.setTextColor(30, 30, 30);
      const numText = `#${plant.number}`;
      doc.text(numText, x + labelW - PAD - doc.getTextWidth(numText), textY);

    } else if (isCompact) {
      // Bracelet: text left, barcode right-center, #N top-right (labelH < 25mm)
      const barcodeW = Math.min(30, labelW * 0.2);
      const barcodeH = labelH - PAD * 2 - 2;
      const barcodeX = x + labelW - PAD - barcodeW - 25; // справа от центра, перед #N

      doc.setFont('Roboto', 'bold'); doc.setFontSize(7); doc.setTextColor(30, 30, 30);
      doc.text(`${room.name || '—'}`, x + PAD, y + PAD + 4);
      doc.setFont('Roboto', 'normal'); doc.setFontSize(6); doc.setTextColor(80, 80, 80);
      let st = plant.strain || room.strain || '—';
      const maxStW = barcodeX - x - PAD * 2;
      if (doc.getTextWidth(st) > maxStW) { while (doc.getTextWidth(st + '..') > maxStW && st.length > 5) st = st.slice(0, -1); st += '..'; }
      doc.text(st, x + PAD, y + PAD + 8.5);
      doc.setFontSize(5.5);
      doc.text(`${startDateStr} - ${harvestDateStr}`, x + PAD, y + PAD + 12.5);

      doc.addImage(barcodeDataUrl, 'PNG', barcodeX, y + PAD + 1, barcodeW, barcodeH);

      doc.setFont('Roboto', 'bold'); doc.setFontSize(10); doc.setTextColor(30, 30, 30);
      const numLabel = `#${plant.number}`;
      doc.text(numLabel, x + labelW - PAD - doc.getTextWidth(numLabel), y + labelH / 2 + 2);

    } else {
      // Bracelet/standard: text left, compact barcode center-right, #N far right
      // Для A4 1x10 (200x26mm) — всё в одну линию как браслет
      const isBracelet = labelH < 35;

      if (isBracelet) {
        // Одна строка: инфо слева | штрихкод по центру | #N справа
        const barcodeW = Math.min(35, labelW * 0.2);
        const barcodeH = labelH - PAD * 2 - 4;
        const barcodeX = x + (labelW - barcodeW) / 2;

        // Текст слева — две строки
        doc.setFont('Roboto', 'bold'); doc.setFontSize(8); doc.setTextColor(30, 30, 30);
        doc.text(`${room.name || '—'}`, x + PAD, y + PAD + 5);
        doc.setFont('Roboto', 'normal'); doc.setFontSize(6); doc.setTextColor(80, 80, 80);
        let st = plant.strain || room.strain || '—';
        const maxStW = barcodeX - x - PAD * 2;
        if (doc.getTextWidth(st) > maxStW) { while (doc.getTextWidth(st + '..') > maxStW && st.length > 5) st = st.slice(0, -1); st += '..'; }
        doc.text(st, x + PAD, y + PAD + 10);
        doc.setFontSize(5.5);
        doc.text(`${startDateStr} — ${harvestDateStr}`, x + PAD, y + PAD + 14.5);

        // Штрихкод по центру — компактный
        doc.addImage(barcodeDataUrl, 'PNG', barcodeX, y + PAD + 1, barcodeW, barcodeH);

        // Номер справа — крупный
        doc.setFont('Roboto', 'bold'); doc.setFontSize(14); doc.setTextColor(30, 30, 30);
        const numLabel = `#${plant.number}`;
        doc.text(numLabel, x + labelW - PAD - doc.getTextWidth(numLabel), y + labelH / 2 + 3);

      } else {
        // Большие этикетки: текст сверху, штрихкод по центру снизу
        doc.setFont('Roboto', 'bold'); doc.setFontSize(9); doc.setTextColor(30, 30, 30);
        doc.text(`${room.name || '—'}`, x + PAD, y + PAD + 3.5);
        const pl = `#${plant.number}`;
        doc.text(pl, x + labelW - PAD - doc.getTextWidth(pl), y + PAD + 3.5);
        doc.setFont('Roboto', 'normal'); doc.setFontSize(7); doc.setTextColor(80, 80, 80);
        doc.text(`Старт: ${startDateStr}`, x + PAD, y + PAD + 8);
        const maxTW = labelW - PAD * 2;
        let st = plant.strain || room.strain || '—';
        if (doc.getTextWidth(st) > maxTW) { while (doc.getTextWidth(st + '...') > maxTW && st.length > 10) st = st.slice(0, -1); st += '...'; }
        doc.text(st, x + PAD, y + PAD + 12);
        doc.text(`Урожай: ${harvestDateStr}`, x + PAD, y + PAD + 16);

        const barcodeW = Math.min(50, labelW * 0.35);
        const barcodeH = Math.max(labelH - 22 - PAD, 8);
        const barcodeX = x + (labelW - barcodeW) / 2;
        doc.addImage(barcodeDataUrl, 'PNG', barcodeX, y + PAD + 18, barcodeW, barcodeH);
      }
    }
  }

  const blobUrl = doc.output('bloburl');
  const win = window.open(blobUrl, '_blank');
  if (!win) {
    // Попап-блокер — скачать как файл
    doc.save(`labels-${plants.length}.pdf`);
  }
}

// ── Component ──
const Labels = () => {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [selectedPlants, setSelectedPlants] = useState(new Set());
  const [generating, setGenerating] = useState(false);

  // Label format — sheet-based
  const [sheetIdx, setSheetIdx] = useState(0); // Браслеты 8x10" default
  const [sheetW, setSheetW] = useState(SHEET_SIZES[0].w);
  const [sheetH, setSheetH] = useState(SHEET_SIZES[0].h);
  const [marginLR, setMarginLR] = useState(SHEET_SIZES[0].marginLR ?? DEFAULT_MARGIN);
  const [marginTB, setMarginTB] = useState(SHEET_SIZES[0].marginTB ?? DEFAULT_MARGIN);
  const [labelGap, setLabelGap] = useState(SHEET_SIZES[0].gap ?? DEFAULT_GAP);
  const [cols, setCols] = useState(SHEET_SIZES[0].defaultCols ?? 1);
  const [countPerSheet, setCountPerSheet] = useState(SHEET_SIZES[0].defaultCount ?? 10);

  const handleSheetChange = (idx) => {
    setSheetIdx(idx);
    if (idx < SHEET_SIZES.length) {
      const s = SHEET_SIZES[idx];
      setSheetW(s.w);
      setSheetH(s.h);
      setMarginLR(s.marginLR ?? DEFAULT_MARGIN);
      setMarginTB(s.marginTB ?? DEFAULT_MARGIN);
      setLabelGap(s.gap ?? DEFAULT_GAP);
      if (s.defaultCols) setCols(s.defaultCols);
      if (s.defaultCount) setCountPerSheet(s.defaultCount);
    }
  };

  const layout = calcFromSheet(sheetW, sheetH, cols, countPerSheet, marginLR, marginTB, labelGap);

  useEffect(() => { loadRooms(); }, []);

  const loadRooms = async () => {
    try {
      setLoading(true); setError('');
      const data = await roomService.getRooms();
      setRooms(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Ошибка загрузки');
    } finally { setLoading(false); }
  };

  const activeRooms = useMemo(() => rooms.filter(r => r.isActive && r.flowerStrains?.length > 0), [rooms]);
  const selectedRoom = useMemo(() => rooms.find(r => r._id === selectedRoomId) || null, [rooms, selectedRoomId]);

  const allPlants = useMemo(() => {
    if (!selectedRoom?.flowerStrains) return [];
    const result = [];
    selectedRoom.flowerStrains.forEach(fs => {
      const start = fs.startNumber ?? 1;
      const end = fs.endNumber ?? (start + (fs.quantity || 1) - 1);
      for (let n = start; n <= end; n++) result.push({ number: n, strain: fs.strain });
    });
    return result;
  }, [selectedRoom]);

  const plantsByStrain = useMemo(() => {
    const groups = {};
    allPlants.forEach(p => { const k = p.strain || '—'; if (!groups[k]) groups[k] = []; groups[k].push(p); });
    return groups;
  }, [allPlants]);

  // Room layout data
  const roomLayout = useMemo(() => {
    if (!selectedRoom?.roomLayout) return null;
    const migrated = migrateLayout(selectedRoom.roomLayout);
    if (migrated.customRows.length === 0) return null;
    return migrated;
  }, [selectedRoom]);

  const positionMap = useMemo(() => {
    if (!roomLayout) return {};
    const m = {};
    roomLayout.plantPositions.forEach(p => { m[`${p.row}:${p.position}`] = p.plantNumber; });
    return m;
  }, [roomLayout]);

  // Plants grouped by room row
  const plantsByRow = useMemo(() => {
    if (!roomLayout) return {};
    const groups = {};
    roomLayout.customRows.forEach((_, rowIdx) => { groups[rowIdx] = []; });
    roomLayout.plantPositions.forEach(p => {
      if (groups[p.row]) groups[p.row].push(p.plantNumber);
    });
    return groups;
  }, [roomLayout]);

  const selectAll = () => setSelectedPlants(new Set(allPlants.map(p => p.number)));
  const deselectAll = () => setSelectedPlants(new Set());

  const togglePlant = (num) => {
    setSelectedPlants(prev => { const n = new Set(prev); n.has(num) ? n.delete(num) : n.add(num); return n; });
  };

  const toggleStrain = (strain) => {
    const plants = plantsByStrain[strain] || [];
    const allSel = plants.every(p => selectedPlants.has(p.number));
    setSelectedPlants(prev => { const n = new Set(prev); plants.forEach(p => allSel ? n.delete(p.number) : n.add(p.number)); return n; });
  };

  const toggleRow = (rowIdx) => {
    const nums = plantsByRow[rowIdx] || [];
    const allSel = nums.every(n => selectedPlants.has(n));
    setSelectedPlants(prev => { const next = new Set(prev); nums.forEach(n => allSel ? next.delete(n) : next.add(n)); return next; });
  };

  const handleSelectRoom = (roomId) => {
    setSelectedRoomId(roomId);
    const room = rooms.find(r => r._id === roomId);
    if (room?.flowerStrains) {
      const nums = new Set();
      room.flowerStrains.forEach(fs => {
        const start = fs.startNumber ?? 1;
        const end = fs.endNumber ?? (start + (fs.quantity || 1) - 1);
        for (let n = start; n <= end; n++) nums.add(n);
      });
      setSelectedPlants(nums);
    }
  };

  const handlePrint = async () => {
    if (!selectedRoom || selectedPlants.size === 0) return;
    const plants = allPlants.filter(p => selectedPlants.has(p.number));
    try {
      setGenerating(true);
      await generateLabelsPDF(selectedRoom, plants, {
        cols, labelW: layout.labelW, labelH: layout.labelH,
        sheetW, sheetH, perPage: layout.perPage,
        marginLR: layout.marginLR, marginTB: layout.marginTB, gap: layout.gap
      });
    } catch (err) { console.error('PDF generation error:', err); setError(`Ошибка генерации PDF: ${err.message || err}`); }
    finally { setGenerating(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" /></div>;
  }

  // ═══ Screen 2: Room selected ═══
  if (selectedRoom) {
    const flowerStrains = selectedRoom.flowerStrains || [];

    return (
      <div>
        {/* Header */}
        <div className="mb-6">
          <button onClick={() => { setSelectedRoomId(null); setSelectedPlants(new Set()); }}
            className="text-dark-400 hover:text-white text-sm mb-2 flex items-center gap-1 transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            К выбору комнаты
          </button>
          <h1 className="text-2xl font-bold text-white">Печать этикеток — {selectedRoom.name}</h1>
        </div>

        {/* Room info */}
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4 mb-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-dark-400">Сорт: <span className="text-white">{selectedRoom.strain || selectedRoom.cycleName || '—'}</span></span>
            <span className="text-dark-400">Старт: <span className="text-white">{formatDateShort(selectedRoom.startDate)}</span></span>
            <span className="text-dark-400">Урожай: <span className="text-white">{formatDateShort(selectedRoom.expectedHarvestDate)}</span></span>
            <span className="text-dark-400">Кустов: <span className="text-white">{allPlants.length}</span></span>
          </div>
        </div>

        {/* Room map visualization */}
        {roomLayout && roomLayout.customRows.length > 0 && (
          <div className="bg-dark-800 rounded-xl border border-dark-700 p-4 mb-4">
            <div className="text-xs text-dark-400 font-medium mb-3">Карта комнаты — выбор по рядам</div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {roomLayout.customRows.map((row, rowIdx) => {
                const cols = row.cols || 1;
                const rowsCount = row.rows || 1;
                const rowPlants = plantsByRow[rowIdx] || [];
                const allRowSelected = rowPlants.length > 0 && rowPlants.every(n => selectedPlants.has(n));
                const someRowSelected = rowPlants.some(n => selectedPlants.has(n));

                return (
                  <div key={rowIdx} className="flex flex-col items-center shrink-0">
                    {/* Row header with select toggle */}
                    <button
                      onClick={() => toggleRow(rowIdx)}
                      className="flex items-center gap-1.5 mb-1.5 group"
                    >
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition ${
                        allRowSelected ? 'bg-primary-500 border-primary-500' : someRowSelected ? 'border-primary-500' : 'border-dark-500 group-hover:border-dark-400'
                      }`}>
                        {allRowSelected && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {!allRowSelected && someRowSelected && <div className="w-2 h-0.5 bg-primary-500 rounded" />}
                      </div>
                      <span className="text-xs text-dark-400 font-medium whitespace-nowrap group-hover:text-dark-300 transition">
                        {row.name || `Ряд ${rowIdx + 1}`}
                      </span>
                      <span className="text-[10px] text-dark-600">({rowPlants.length})</span>
                    </button>

                    {/* Mini grid */}
                    <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                      {Array.from({ length: rowsCount }, (_, rIdx) =>
                        Array.from({ length: cols }, (_, cIdx) => {
                          const posIdx = rIdx * cols + cIdx;
                          const plantNumber = positionMap[`${rowIdx}:${posIdx}`];
                          const strain = plantNumber ? getStrainForPlant(plantNumber, flowerStrains) : null;
                          const isSelected = plantNumber && selectedPlants.has(plantNumber);
                          const color = strain ? STRAIN_COLORS[strain.strainIndex % STRAIN_COLORS.length] : null;

                          if (!plantNumber) {
                            return (
                              <div key={posIdx}
                                className="w-8 h-8 border border-dashed border-dark-700 rounded flex items-center justify-center text-dark-700 text-[8px]">
                                —
                              </div>
                            );
                          }

                          return (
                            <button key={posIdx} onClick={() => togglePlant(plantNumber)}
                              className={`w-8 h-8 rounded flex items-center justify-center text-[10px] font-bold transition border ${
                                isSelected
                                  ? `${color?.bg || 'bg-primary-500/20'} ${color?.border || 'border-primary-500'} ${color?.text || 'text-primary-400'} ring-1 ring-white/30`
                                  : 'bg-dark-700/50 border-dark-600 text-dark-500 hover:border-dark-500'
                              }`}
                              title={`#${plantNumber} — ${strain?.strain || '?'}`}
                            >
                              {plantNumber}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Strain legend */}
            {flowerStrains.length > 1 && (
              <div className="flex flex-wrap gap-3 mt-3 pt-2 border-t border-dark-700">
                {flowerStrains.map((fs, idx) => {
                  const color = STRAIN_COLORS[idx % STRAIN_COLORS.length];
                  return (
                    <div key={idx} className="flex items-center gap-1.5">
                      <div className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                      <span className="text-xs text-dark-400">{fs.strain} ({fs.quantity})</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Label format settings */}
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4 mb-4">
          <div className="text-xs text-dark-400 font-medium mb-3">Настройки печати</div>

          {/* Sheet size */}
          <div className="flex flex-wrap gap-2 mb-3">
            {SHEET_SIZES.map((s, i) => (
              <button key={i} onClick={() => handleSheetChange(i)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                  sheetIdx === i
                    ? 'bg-primary-600/30 border-primary-500/50 text-primary-300'
                    : 'bg-dark-700 border-dark-600 text-dark-400 hover:border-dark-500'
                }`}>{s.name} ({s.w}x{s.h})</button>
            ))}
            <button onClick={() => handleSheetChange(SHEET_SIZES.length)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                sheetIdx >= SHEET_SIZES.length
                  ? 'bg-primary-600/30 border-primary-500/50 text-primary-300'
                  : 'bg-dark-700 border-dark-600 text-dark-400 hover:border-dark-500'
              }`}>Свой размер</button>
          </div>

          <div className="flex flex-wrap gap-4 items-end">
            {sheetIdx >= SHEET_SIZES.length && (
              <>
                <label className="text-xs">
                  <span className="text-dark-400 block mb-1">Ширина листа (мм)</span>
                  <input type="number" min={50} max={500} value={sheetW}
                    onChange={e => setSheetW(Math.max(50, Math.min(500, +e.target.value || 50)))}
                    className="w-20 px-2 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                </label>
                <label className="text-xs">
                  <span className="text-dark-400 block mb-1">Высота листа (мм)</span>
                  <input type="number" min={50} max={500} value={sheetH}
                    onChange={e => setSheetH(Math.max(50, Math.min(500, +e.target.value || 50)))}
                    className="w-20 px-2 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
                </label>
              </>
            )}
            <label className="text-xs">
              <span className="text-dark-400 block mb-1">Колонок</span>
              <input type="number" min={1} max={20} value={cols}
                onChange={e => setCols(Math.max(1, Math.min(20, +e.target.value || 1)))}
                className="w-16 px-2 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
            </label>
            <label className="text-xs">
              <span className="text-dark-400 block mb-1">Браслетов на лист</span>
              <input type="number" min={1} max={50} value={countPerSheet}
                onChange={e => setCountPerSheet(Math.max(1, Math.min(50, +e.target.value || 1)))}
                className="w-20 px-2 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
            </label>
            <label className="text-xs">
              <span className="text-dark-400 block mb-1">Отступ Л/П (мм)</span>
              <input type="number" min={0} max={50} step={0.5} value={marginLR}
                onChange={e => setMarginLR(Math.max(0, Math.min(50, +e.target.value || 0)))}
                className="w-16 px-2 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
            </label>
            <label className="text-xs">
              <span className="text-dark-400 block mb-1">Отступ В/Н (мм)</span>
              <input type="number" min={0} max={50} step={0.5} value={marginTB}
                onChange={e => setMarginTB(Math.max(0, Math.min(50, +e.target.value || 0)))}
                className="w-16 px-2 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
            </label>
            <label className="text-xs">
              <span className="text-dark-400 block mb-1">Зазор (мм)</span>
              <input type="number" min={0} max={20} step={0.5} value={labelGap}
                onChange={e => setLabelGap(Math.max(0, Math.min(20, +e.target.value || 0)))}
                className="w-16 px-2 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-white text-sm" />
            </label>
          </div>

          <div className="mt-3 text-xs text-dark-500">
            Размер этикетки: <span className="text-dark-300 font-medium">{layout.labelW}x{layout.labelH} мм</span>
            <span className="mx-2">|</span>
            {cols} x {layout.rows} = <span className="text-dark-300 font-medium">{layout.perPage} шт/лист</span>
            {selectedPlants.size > 0 && (
              <span className="ml-2">= {Math.ceil(selectedPlants.size / layout.perPage)} лист.</span>
            )}
          </div>
        </div>

        {/* Actions bar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button onClick={selectAll} className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-300 hover:text-white rounded-lg text-sm transition">
            Выбрать все
          </button>
          <button onClick={deselectAll} className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-300 hover:text-white rounded-lg text-sm transition">
            Снять все
          </button>
          <div className="flex-1" />
          <button onClick={handlePrint} disabled={selectedPlants.size === 0 || generating}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
              selectedPlants.size === 0 || generating
                ? 'bg-dark-700 text-dark-500 cursor-not-allowed'
                : 'bg-primary-600 hover:bg-primary-500 text-white'
            }`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            {generating ? 'Генерация...' : `Печать PDF (${selectedPlants.size} шт)`}
          </button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4">{error}</div>
        )}

        {/* Plant list grouped by strain */}
        <div className="space-y-4">
          {Object.entries(plantsByStrain).map(([strain, plants]) => {
            const allSel = plants.every(p => selectedPlants.has(p.number));
            const someSel = plants.some(p => selectedPlants.has(p.number));
            return (
              <div key={strain} className="bg-dark-800 rounded-xl border border-dark-700 p-4">
                <button onClick={() => toggleStrain(strain)} className="flex items-center gap-3 w-full text-left mb-3">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                    allSel ? 'bg-primary-500 border-primary-500' : someSel ? 'border-primary-500' : 'border-dark-500'
                  }`}>
                    {allSel && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                    {!allSel && someSel && <div className="w-2.5 h-0.5 bg-primary-500 rounded" />}
                  </div>
                  <span className="text-white font-medium">{strain}</span>
                  <span className="text-dark-500 text-sm">({plants.length} шт, №{plants[0].number}–{plants[plants.length - 1].number})</span>
                </button>
                <div className="flex flex-wrap gap-1.5">
                  {plants.map(p => (
                    <button key={p.number} onClick={() => togglePlant(p.number)}
                      className={`w-10 h-8 rounded text-xs font-medium transition border ${
                        selectedPlants.has(p.number)
                          ? 'bg-primary-600/30 border-primary-500/50 text-primary-300'
                          : 'bg-dark-700 border-dark-600 text-dark-400 hover:border-dark-500'
                      }`}>{p.number}</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ═══ Screen 1: Room selection ═══
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Печать этикеток</h1>
        <p className="text-dark-400 mt-1 text-sm">Выберите комнату для генерации этикеток со штрихкодами</p>
      </div>
      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6 flex flex-wrap items-center gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => { setError(''); loadRooms(); }} className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium">Повторить</button>
        </div>
      )}
      {activeRooms.length === 0 ? (
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-8 text-center">
          <p className="text-dark-400">Нет активных комнат с пронумерованными кустами</p>
          <p className="text-dark-500 text-sm mt-1">Запустите цикл и укажите сорта с нумерацией в Активных комнатах</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {activeRooms.map(room => {
            const totalPlants = room.flowerStrains.reduce((s, fs) => s + (fs.quantity || 0), 0);
            const strainNames = room.flowerStrains.map(fs => fs.strain).filter(Boolean);
            return (
              <button key={room._id} onClick={() => handleSelectRoom(room._id)}
                className="bg-dark-800 rounded-xl border border-dark-700 p-5 text-left hover:border-primary-700/50 transition group">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white font-semibold group-hover:text-primary-400 transition">{room.name}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                    <span className="text-primary-400">Цветёт</span>
                  </span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="text-dark-400">Сорт: <span className="text-dark-300">{strainNames.join(', ') || room.strain || '—'}</span></div>
                  <div className="text-dark-400">Кустов: <span className="text-dark-300">{totalPlants}</span></div>
                  <div className="text-dark-400">Старт: <span className="text-dark-300">{formatDateShort(room.startDate)}</span></div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Labels;
