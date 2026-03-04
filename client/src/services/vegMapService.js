import api from './api';

export const vegMapService = {
  async get() {
    const response = await api.get('/veg-map');
    return response.data;
  },

  async save(data) {
    const response = await api.put('/veg-map', data);
    return response.data;
  },

  async clearPositions() {
    const response = await api.delete('/veg-map/positions');
    return response.data;
  }
};
