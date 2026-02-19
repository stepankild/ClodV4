import { useState, useEffect } from 'react';
import { connectScale, disconnectScale, onScaleEvent } from '../services/scaleSocket';

/**
 * React hook для получения сканов штрихкодов через Socket.io.
 *
 * @returns {{
 *   lastBarcode: string|null,       — последний отсканированный штрихкод
 *   scanTime: number|null,          — timestamp последнего скана (Date.now())
 *   barcodeWeight: number|null,     — вес на момент скана (если передан от Pi)
 *   barcodeWeightUnit: string|null, — единица измерения веса
 *   barcodeWeightStable: boolean,   — стабильно ли показание
 *   barcodeBuffered: boolean        — был ли скан из оффлайн-буфера Pi
 * }}
 */
export function useBarcode() {
  const [lastBarcode, setLastBarcode] = useState(null);
  const [scanTime, setScanTime] = useState(null);
  const [barcodeWeight, setBarcodeWeight] = useState(null);
  const [barcodeWeightUnit, setBarcodeWeightUnit] = useState(null);
  const [barcodeWeightStable, setBarcodeWeightStable] = useState(false);
  const [barcodeBuffered, setBarcodeBuffered] = useState(false);

  useEffect(() => {
    connectScale();

    const unsubscribe = onScaleEvent((event, data) => {
      if (event === 'barcode') {
        setLastBarcode(data.barcode || null);
        setScanTime(Date.now());
        setBarcodeWeight(data.weight != null ? data.weight : null);
        setBarcodeWeightUnit(data.unit || null);
        setBarcodeWeightStable(!!data.stable);
        setBarcodeBuffered(!!data.buffered);
      }
    });

    return () => {
      unsubscribe();
    };
    // Не вызываем disconnectScale() — useScale тоже использует тот же socket
  }, []);

  return { lastBarcode, scanTime, barcodeWeight, barcodeWeightUnit, barcodeWeightStable, barcodeBuffered };
}
