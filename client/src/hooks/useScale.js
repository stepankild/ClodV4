import { useState, useEffect } from 'react';
import { connectScale, disconnectScale, onScaleEvent } from '../services/scaleSocket';

/**
 * React hook для получения live-данных с весов через Socket.io.
 *
 * @returns {{
 *   weight: number|null,       — текущий вес (null если нет данных)
 *   unit: string,              — единица измерения ('g')
 *   stable: boolean,           — показание стабильно
 *   scaleConnected: boolean,   — весы подключены к серверу (Pi online)
 *   socketConnected: boolean   — WebSocket соединение с сервером активно
 * }}
 */
export function useScale() {
  const [weight, setWeight] = useState(null);
  const [unit, setUnit] = useState('g');
  const [stable, setStable] = useState(false);
  const [scaleConnected, setScaleConnected] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);

  useEffect(() => {
    connectScale();

    const unsubscribe = onScaleEvent((event, data) => {
      switch (event) {
        case 'weight':
          setWeight(data.weight);
          setUnit(data.unit || 'g');
          setStable(data.stable ?? false);
          setScaleConnected(true);
          break;
        case 'status':
          setScaleConnected(data.connected);
          if (!data.connected) {
            setWeight(null);
            setStable(false);
          }
          break;
        case 'socketConnected':
          setSocketConnected(true);
          break;
        case 'socketDisconnected':
          setSocketConnected(false);
          setScaleConnected(false);
          break;
      }
    });

    return () => {
      unsubscribe();
      disconnectScale();
    };
  }, []);

  return { weight, unit, stable, scaleConnected, socketConnected };
}
