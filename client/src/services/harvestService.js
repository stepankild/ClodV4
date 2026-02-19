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

  async addPlant(sessionId, plantNumber, wetWeight, overrideWorkerId) {
    const body = { plantNumber, wetWeight };
    if (overrideWorkerId) body.overrideWorkerId = overrideWorkerId;
    const response = await api.post(`/harvest/session/${sessionId}/plant`, body);
    return response.data;
  },

  async removePlant(sessionId, plantNumber) {
    const response = await api.delete(`/harvest/session/${sessionId}/plant/${plantNumber}`);
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
  },

  // Crew (роли при сборе)
  async getWorkers() {
    const response = await api.get('/harvest/workers');
    return response.data;
  },

  async joinSession(sessionId, role) {
    const response = await api.post(`/harvest/session/${sessionId}/join`, { role });
    return response.data;
  },

  async forceJoinSession(sessionId, role) {
    const response = await api.post(`/harvest/session/${sessionId}/force-join`, { role });
    return response.data;
  },

  async leaveSession(sessionId) {
    const response = await api.delete(`/harvest/session/${sessionId}/leave`);
    return response.data;
  }
};
