import api from './api';

export const vegBatchService = {
  async getAll(params = {}) {
    const q = new URLSearchParams(params).toString();
    const url = q ? `/veg-batches?${q}` : '/veg-batches';
    const response = await api.get(url);
    return response.data;
  },

  async getInVeg() {
    const response = await api.get('/veg-batches?inVeg=true');
    return response.data;
  },

  async getByFlowerRoom(roomId) {
    const response = await api.get(`/veg-batches?flowerRoom=${roomId}`);
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
    const response = await api.delete(`/veg-batches/${id}`);
    return response.data;
  }
};
