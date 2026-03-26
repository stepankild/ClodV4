import { useState, useEffect } from 'react';
import { connectScale, onScaleEvent } from '../services/scaleSocket';

/**
 * React hook для получения live-данных с IoT сенсоров через Socket.io.
 * Возвращает Map-like объект зон с текущими данными.
 *
 * @returns {Object} zones — { 'zone-1': { online, lastData, lastSeen }, ... }
 */
export function useSensors() {
  const [zones, setZones] = useState({});

  useEffect(() => {
    connectScale();

    const unsubscribe = onScaleEvent((event, data) => {
      switch (event) {
        case 'sensor_zones':
          setZones(data);
          break;
        case 'sensor_data':
          setZones(prev => ({
            ...prev,
            [data.zoneId]: {
              ...prev[data.zoneId],
              online: true,
              lastData: data,
              lastSeen: new Date().toISOString()
            }
          }));
          break;
        case 'sensor_status':
          setZones(prev => ({
            ...prev,
            [data.zoneId]: {
              ...prev[data.zoneId],
              online: data.online,
              lastSeen: new Date().toISOString()
            }
          }));
          break;
      }
    });

    return () => unsubscribe();
  }, []);

  return zones;
}
