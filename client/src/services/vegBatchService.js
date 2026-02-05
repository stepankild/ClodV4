import api from './api';

export const vegBatchService = {
  async getAll(params = {}) {
    const response = await api.get('/veg-batches', { params });
    return response.data;
  },

  async getInVeg() {
    const response = await api.get('/veg-batches', { params: { inVeg: 'true' } });
    return response.data;
  },

  async create(data) {
    const response = await api.post('/veg-batches', data);
    return response.data;
  },

  async update(id, data) {
    const response = await api.put(`/veg-batches/${id}`, data);
    return response.data;
  },

  async delete(id) {
    await api.delete(`/veg-batches/${id}`);
  }
};
