import api from './api';

export const cloneCutService = {
  async getAll() {
    const response = await api.get('/clone-cuts');
    return response.data;
  },

  async upsert(data) {
    const response = await api.post('/clone-cuts', data);
    return response.data;
  },

  async update(id, data) {
    const response = await api.put(`/clone-cuts/${id}`, data);
    return response.data;
  }
};
