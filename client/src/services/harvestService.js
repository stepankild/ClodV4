import api from './api';

export const harvestService = {
  async getScaleReading() {
    const response = await api.get('/harvest/scale');
    return response.data;
  },

  async getSessionByRoom(roomId) {
    const response = await api.get('/harvest/session', { params: { roomId } });
    return response.data;
  },

  async createSession(roomId) {
    const response = await api.post('/harvest/session', { roomId });
    return response.data;
  },

  async addPlant(sessionId, plantNumber, wetWeight) {
    const response = await api.post(`/harvest/session/${sessionId}/plant`, {
      plantNumber,
      wetWeight
    });
    return response.data;
  },

  async setPlantErrorNote(sessionId, plantNumber, errorNote) {
    const response = await api.patch(
      `/harvest/session/${sessionId}/plant/${plantNumber}`,
      { errorNote }
    );
    return response.data;
  },

  async completeSession(sessionId) {
    const response = await api.post(`/harvest/session/${sessionId}/complete`);
    return response.data;
  },

  async getSessions(params = {}) {
    const response = await api.get('/harvest/sessions', { params });
    return response.data;
  }
};
