import api from './api';

export const iotService = {
  async getZones() {
    const response = await api.get('/zones');
    return response.data;
  },

  async getZone(zoneId) {
    const response = await api.get(`/zones/${zoneId}`);
    return response.data;
  },

  async createZone(data) {
    const response = await api.post('/zones', data);
    return response.data;
  },

  async updateZone(zoneId, data) {
    const response = await api.put(`/zones/${zoneId}`, data);
    return response.data;
  },

  async deleteZone(zoneId) {
    const response = await api.delete(`/zones/${zoneId}`);
    return response.data;
  },

  async getReadings(zoneId, params = {}) {
    const response = await api.get(`/zones/${zoneId}/readings`, { params });
    return response.data;
  },

  async getLatestReading(zoneId) {
    const response = await api.get(`/zones/${zoneId}/readings/latest`);
    return response.data;
  }
};
