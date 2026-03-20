import api from './api';

export const motherRoomService = {
  // Plants
  async getPlants(params = {}) {
    const response = await api.get('/mother-room/plants', { params });
    return response.data;
  },

  async createPlant(data) {
    const response = await api.post('/mother-room/plants', data);
    return response.data;
  },

  async updatePlant(id, data) {
    const response = await api.put(`/mother-room/plants/${id}`, data);
    return response.data;
  },

  async recordPrune(id, data) {
    const response = await api.post(`/mother-room/plants/${id}/prune`, data);
    return response.data;
  },

  async retirePlant(id, reason) {
    const response = await api.post(`/mother-room/plants/${id}/retire`, { reason });
    return response.data;
  },

  async deletePlant(id) {
    const response = await api.delete(`/mother-room/plants/${id}`);
    return response.data;
  },

  async getDeletedPlants() {
    const response = await api.get('/mother-room/plants/deleted');
    return response.data;
  },

  async restorePlant(id) {
    const response = await api.post(`/mother-room/plants/deleted/${id}/restore`);
    return response.data;
  },

  // Map
  async getMap() {
    const response = await api.get('/mother-room/map');
    return response.data;
  },

  async saveMap(data) {
    const response = await api.put('/mother-room/map', data);
    return response.data;
  },

  async clearMapPositions() {
    const response = await api.delete('/mother-room/map/positions');
    return response.data;
  }
};
