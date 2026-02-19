import { useState, useEffect } from 'react';
import { connectScale, disconnectScale, onScaleEvent } from '../services/scaleSocket';

/**
 * Конвертировать вес в граммы.
 */
function toGrams(weight, unit) {
  if (weight == null) return null;
  switch (unit) {
    case 'kg': return weight * 1000;
    case 'lb': return weight * 453.592;
    case 'oz': return weight * 28.3495;
    default: return weight; // уже в граммах
  }
}

/**
 * React hook для получения live-данных с весов через Socket.io.
 * Вес всегда возвращается в граммах (округлённый).
 *
 * @returns {{
 *   weight: number|null,       — текущий вес в граммах (null если нет данных)
 *   unit: string,              — всегда 'g'
 *   stable: boolean,           — показание стабильно
 *   scaleConnected: boolean,   — весы подключены к серверу (Pi online)
 *   socketConnected: boolean,  — WebSocket соединение с сервером активно
 *   debug: object|null         — диагностика от Pi (обновляется каждые 5 сек)
 * }}
 */
export function useScale() {
  const [weight, setWeight] = useState(null);
  const [stable, setStable] = useState(false);
  const [scaleConnected, setScaleConnected] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [debug, setDebug] = useState(null);

  useEffect(() => {
    connectScale();

    const unsubscribe = onScaleEvent((event, data) => {
      switch (event) {
        case 'weight': {
          const grams = toGrams(data.weight, data.unit || 'g');
          setWeight(grams != null ? Math.round(grams) : null);
          setStable(data.stable ?? false);
          setScaleConnected(true);
          break;
        }
        case 'status':
          setScaleConnected(data.connected);
          if (!data.connected) {
            setWeight(null);
            setStable(false);
          }
          break;
        case 'debug':
          setDebug(data);
          break;
        case 'socketConnected':
          setSocketConnected(true);
          break;
        case 'socketDisconnected':
          setSocketConnected(false);
          setScaleConnected(false);
          setDebug(null);
          break;
      }
    });

    return () => {
      unsubscribe();
      disconnectScale();
    };
  }, []);

  return { weight, unit: 'g', stable, scaleConnected, socketConnected, debug };
}
