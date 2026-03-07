import api from './api';

export const treatmentService = {
  async getAll(params = {}) {
    const response = await api.get('/treatments', { params });
    return response.data;
  },

  async getCalendar(from, to) {
    const response = await api.get('/treatments/calendar', { params: { from, to } });
    return response.data;
  },

  async getRoomHistory(roomId) {
    const response = await api.get(`/treatments/room/${roomId}`);
    return response.data;
  },

  async create(data) {
    const response = await api.post('/treatments', data);
    return response.data;
  },

  async update(id, data) {
    const response = await api.put(`/treatments/${id}`, data);
    return response.data;
  },

  async complete(id) {
    const response = await api.put(`/treatments/${id}/complete`);
    return response.data;
  },

  async skip(id, notes) {
    const response = await api.put(`/treatments/${id}/skip`, { notes });
    return response.data;
  },

  async delete(id) {
    await api.delete(`/treatments/${id}`);
  },

  async getDeleted() {
    const response = await api.get('/treatments/deleted');
    return response.data;
  },

  async restore(id) {
    const response = await api.post(`/treatments/deleted/${id}/restore`);
    return response.data;
  }
};
