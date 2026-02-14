import api from './api';

export const archiveService = {
  async getArchives(params = {}) {
    const response = await api.get('/archive', { params });
    return response.data;
  },

  async getArchive(id) {
    const response = await api.get(`/archive/${id}`);
    return response.data;
  },

  async harvestAndArchive(roomId, data) {
    const response = await api.post(`/archive/harvest/${roomId}`, data);
    return response.data;
  },

  async updateArchive(id, data) {
    const response = await api.put(`/archive/${id}`, data);
    return response.data;
  },

  async deleteArchive(id) {
    await api.delete(`/archive/${id}`);
  },

  async getDeleted() {
    const response = await api.get('/archive/deleted');
    return response.data;
  },

  async restore(id) {
    const response = await api.post(`/archive/deleted/${id}/restore`);
    return response.data;
  },

  /** period: 'all' | 'year' | '6months' | '3months' */
  async getStats(period = 'all') {
    const response = await api.get('/archive/stats', { params: { period } });
    return response.data;
  },

  /** Detailed stats for a specific strain */
  async getStrainStats(strain, period = 'all') {
    const response = await api.get(`/archive/stats/strain/${encodeURIComponent(strain)}`, { params: { period } });
    return response.data;
  },

  /** Detailed stats for a specific room */
  async getRoomStats(roomId, period = 'all') {
    const response = await api.get(`/archive/stats/room/${roomId}`, { params: { period } });
    return response.data;
  }
};
