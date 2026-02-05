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
  },

  async createOrder(data) {
    const response = await api.post('/clone-cuts', { ...data, forOrder: true });
    return response.data;
  },

  async delete(id) {
    const response = await api.delete(`/clone-cuts/${id}`);
    return response.data;
  },

  async getDeleted() {
    const response = await api.get('/clone-cuts/deleted');
    return response.data;
  },

  async restore(id) {
    const response = await api.post(`/clone-cuts/deleted/${id}/restore`);
    return response.data;
  }
};
