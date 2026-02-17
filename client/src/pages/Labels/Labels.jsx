import { useState, useEffect, useMemo } from 'react';
import { roomService } from '../../services/roomService';

const formatDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

// ── PDF generation ──
async function generateLabelsPDF(room, plants) {
  const [{ jsPDF }, { RobotoRegular }, { RobotoBold }, JsBarcodeModule] = await Promise.all([
    import('jspdf'),
    import('../../fonts/Roboto-Regular'),
    import('../../fonts/Roboto-Bold'),
    import('jsbarcode')
  ]);
  const JsBarcode = JsBarcodeModule.default || JsBarcodeModule;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Cyrillic fonts
  doc.addFileToVFS('Roboto-Regular.ttf', RobotoRegular);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.addFileToVFS('Roboto-Bold.ttf', RobotoBold);
  doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
  doc.setFont('Roboto', 'normal');

  // Layout: 3 cols × 8 rows = 24 per page
  const PAGE_W = 210;
  const PAGE_H = 297;
  const MARGIN = 7;
  const COL_GAP = 2;
  const ROW_GAP = 2;
  const COLS = 3;
  const ROWS = 8;
  const LABEL_W = (PAGE_W - MARGIN * 2 - COL_GAP * (COLS - 1)) / COLS; // ~64.7mm
  const LABEL_H = (PAGE_H - MARGIN * 2 - ROW_GAP * (ROWS - 1)) / ROWS; // ~33.6mm
  const PER_PAGE = COLS * ROWS;
  const PAD = 2;

  const startDateStr = formatDate(room.startDate);
  const harvestDateStr = formatDate(room.expectedHarvestDate);

  for (let i = 0; i < plants.length; i++) {
    if (i > 0 && i % PER_PAGE === 0) doc.addPage();

    const idx = i % PER_PAGE;
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const x = MARGIN + col * (LABEL_W + COL_GAP);
    const y = MARGIN + row * (LABEL_H + ROW_GAP);

    const plant = plants[i];

    // Dashed border for cutting
    doc.setDrawColor(180, 180, 180);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.rect(x, y, LABEL_W, LABEL_H);
    doc.setLineDashPattern([], 0);

    // Line 1: Room name (left) + Plant number (right)
    doc.setFont('Roboto', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);
    doc.text(room.name || 'Комната', x + PAD, y + PAD + 3.5);
    const plantLabel = `#${plant.number}`;
    const labelWidth = doc.getTextWidth(plantLabel);
    doc.text(plantLabel, x + LABEL_W - PAD - labelWidth, y + PAD + 3.5);

    // Line 2: Start date
    doc.setFont('Roboto', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(80, 80, 80);
    doc.text(`Старт: ${startDateStr}`, x + PAD, y + PAD + 8);

    // Line 3: Strain
    let strainText = `Сорт: ${plant.strain || room.strain || '—'}`;
    const maxTextW = LABEL_W - PAD * 2;
    if (doc.getTextWidth(strainText) > maxTextW) {
      while (doc.getTextWidth(strainText + '...') > maxTextW && strainText.length > 10) {
        strainText = strainText.slice(0, -1);
      }
      strainText += '...';
    }
    doc.text(strainText, x + PAD, y + PAD + 12);

    // Line 4: Expected harvest
    doc.text(`Урожай: ${harvestDateStr}`, x + PAD, y + PAD + 16);

    // Barcode
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, String(plant.number), {
      format: 'CODE128',
      width: 2,
      height: 40,
      displayValue: true,
      fontSize: 14,
      margin: 2,
      font: 'monospace'
    });
    const barcodeDataUrl = canvas.toDataURL('image/png');
    const barcodeW = LABEL_W - PAD * 2 - 4;
    const barcodeH = 12;
    const barcodeX = x + (LABEL_W - barcodeW) / 2;
    const barcodeY = y + PAD + 18;
    doc.addImage(barcodeDataUrl, 'PNG', barcodeX, barcodeY, barcodeW, barcodeH);
  }

  const blobUrl = doc.output('bloburl');
  window.open(blobUrl, '_blank');
}

// ── Component ──
const Labels = () => {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [selectedPlants, setSelectedPlants] = useState(new Set());
  const [generating, setGenerating] = useState(false);

  useEffect(() => { loadRooms(); }, []);

  const loadRooms = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await roomService.getRooms();
      setRooms(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  const activeRooms = useMemo(() =>
    rooms.filter(r => r.isActive && r.flowerStrains?.length > 0),
    [rooms]
  );

  const selectedRoom = useMemo(() =>
    rooms.find(r => r._id === selectedRoomId) || null,
    [rooms, selectedRoomId]
  );

  const allPlants = useMemo(() => {
    if (!selectedRoom?.flowerStrains) return [];
    const result = [];
    selectedRoom.flowerStrains.forEach(fs => {
      const start = fs.startNumber ?? 1;
      const end = fs.endNumber ?? (start + (fs.quantity || 1) - 1);
      for (let n = start; n <= end; n++) {
        result.push({ number: n, strain: fs.strain });
      }
    });
    return result;
  }, [selectedRoom]);

  // Group plants by strain
  const plantsByStrain = useMemo(() => {
    const groups = {};
    allPlants.forEach(p => {
      const key = p.strain || '—';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    return groups;
  }, [allPlants]);

  const selectAll = () => setSelectedPlants(new Set(allPlants.map(p => p.number)));
  const deselectAll = () => setSelectedPlants(new Set());

  const togglePlant = (num) => {
    setSelectedPlants(prev => {
      const next = new Set(prev);
      next.has(num) ? next.delete(num) : next.add(num);
      return next;
    });
  };

  const toggleStrain = (strain) => {
    const plants = plantsByStrain[strain] || [];
    const allSelected = plants.every(p => selectedPlants.has(p.number));
    setSelectedPlants(prev => {
      const next = new Set(prev);
      plants.forEach(p => allSelected ? next.delete(p.number) : next.add(p.number));
      return next;
    });
  };

  const handleSelectRoom = (roomId) => {
    setSelectedRoomId(roomId);
    // Auto-select all plants
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
      await generateLabelsPDF(selectedRoom, plants);
    } catch (err) {
      console.error(err);
      setError('Ошибка генерации PDF');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500" />
      </div>
    );
  }

  // ═══ Screen 2: Room selected — plant selection ═══
  if (selectedRoom) {
    return (
      <div>
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => { setSelectedRoomId(null); setSelectedPlants(new Set()); }}
            className="text-dark-400 hover:text-white text-sm mb-2 flex items-center gap-1 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            К выбору комнаты
          </button>
          <h1 className="text-2xl font-bold text-white">Печать этикеток — {selectedRoom.name}</h1>
        </div>

        {/* Room info */}
        <div className="bg-dark-800 rounded-xl border border-dark-700 p-4 mb-6">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-dark-400">Сорт: <span className="text-white">{selectedRoom.strain || selectedRoom.cycleName || '—'}</span></span>
            <span className="text-dark-400">Старт: <span className="text-white">{formatDate(selectedRoom.startDate)}</span></span>
            <span className="text-dark-400">Урожай: <span className="text-white">{formatDate(selectedRoom.expectedHarvestDate)}</span></span>
            <span className="text-dark-400">Кустов: <span className="text-white">{allPlants.length}</span></span>
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
          <button
            onClick={handlePrint}
            disabled={selectedPlants.size === 0 || generating}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
              selectedPlants.size === 0 || generating
                ? 'bg-dark-700 text-dark-500 cursor-not-allowed'
                : 'bg-primary-600 hover:bg-primary-500 text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            {generating ? 'Генерация...' : `Печать PDF (${selectedPlants.size} шт)`}
          </button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        {/* Plant list grouped by strain */}
        <div className="space-y-4">
          {Object.entries(plantsByStrain).map(([strain, plants]) => {
            const allStrainSelected = plants.every(p => selectedPlants.has(p.number));
            const someSelected = plants.some(p => selectedPlants.has(p.number));
            return (
              <div key={strain} className="bg-dark-800 rounded-xl border border-dark-700 p-4">
                {/* Strain header */}
                <button
                  onClick={() => toggleStrain(strain)}
                  className="flex items-center gap-3 w-full text-left mb-3"
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                    allStrainSelected ? 'bg-primary-500 border-primary-500' : someSelected ? 'border-primary-500' : 'border-dark-500'
                  }`}>
                    {allStrainSelected && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {!allStrainSelected && someSelected && (
                      <div className="w-2.5 h-0.5 bg-primary-500 rounded" />
                    )}
                  </div>
                  <span className="text-white font-medium">{strain}</span>
                  <span className="text-dark-500 text-sm">({plants.length} шт, №{plants[0].number}–{plants[plants.length - 1].number})</span>
                </button>

                {/* Plant checkboxes */}
                <div className="flex flex-wrap gap-1.5">
                  {plants.map(p => (
                    <button
                      key={p.number}
                      onClick={() => togglePlant(p.number)}
                      className={`w-10 h-8 rounded text-xs font-medium transition border ${
                        selectedPlants.has(p.number)
                          ? 'bg-primary-600/30 border-primary-500/50 text-primary-300'
                          : 'bg-dark-700 border-dark-600 text-dark-400 hover:border-dark-500'
                      }`}
                    >
                      {p.number}
                    </button>
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
          <button type="button" onClick={() => { setError(''); loadRooms(); }} className="px-3 py-1.5 bg-red-800/50 hover:bg-red-700/50 rounded-lg text-sm font-medium">
            Повторить
          </button>
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
              <button
                key={room._id}
                onClick={() => handleSelectRoom(room._id)}
                className="bg-dark-800 rounded-xl border border-dark-700 p-5 text-left hover:border-primary-700/50 transition group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white font-semibold group-hover:text-primary-400 transition">{room.name}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                    <span className="text-primary-400">Цветёт</span>
                  </span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="text-dark-400">
                    Сорт: <span className="text-dark-300">{strainNames.join(', ') || room.strain || '—'}</span>
                  </div>
                  <div className="text-dark-400">
                    Кустов: <span className="text-dark-300">{totalPlants}</span>
                  </div>
                  <div className="text-dark-400">
                    Старт: <span className="text-dark-300">{formatDate(room.startDate)}</span>
                  </div>
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
