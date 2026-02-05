import api from './api';

export const roomService = {
  async getRooms() {
    const response = await api.get('/rooms');
    return response.data;
  },

  async getRoom(id) {
    const response = await api.get(`/rooms/${id}`);
    return response.data;
  },

  async updateRoom(id, data) {
    const response = await api.put(`/rooms/${id}`, data);
    return response.data;
  },

  async startCycle(id, data) {
    const response = await api.post(`/rooms/${id}/start`, data);
    return response.data;
  },

  async harvestRoom(id) {
    const response = await api.post(`/rooms/${id}/harvest`);
    return response.data;
  }
};
