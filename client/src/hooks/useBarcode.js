import { useState, useEffect } from 'react';
import { connectScale, disconnectScale, onScaleEvent } from '../services/scaleSocket';

/**
 * React hook для получения сканов штрихкодов через Socket.io.
 *
 * @returns {{
 *   lastBarcode: string|null,  — последний отсканированный штрихкод
 *   scanTime: number|null      — timestamp последнего скана (Date.now())
 * }}
 */
export function useBarcode() {
  const [lastBarcode, setLastBarcode] = useState(null);
  const [scanTime, setScanTime] = useState(null);

  useEffect(() => {
    connectScale();

    const unsubscribe = onScaleEvent((event, data) => {
      if (event === 'barcode') {
        setLastBarcode(data.barcode || null);
        setScanTime(Date.now());
      }
    });

    return () => {
      unsubscribe();
    };
    // Не вызываем disconnectScale() — useScale тоже использует тот же socket
  }, []);

  return { lastBarcode, scanTime };
}
