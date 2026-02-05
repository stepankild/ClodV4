import api from './api';

export const roomService = {
  async getRooms() {
    const response = await api.get('/rooms');
    return response.data;
  },

  async getRoomsSummary() {
    const response = await api.get('/rooms/summary');
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
  },

  async getPlans(roomId) {
    const url = roomId ? `/rooms/plans?roomId=${roomId}` : '/rooms/plans';
    const response = await api.get(url);
    return response.data;
  },

  async createPlan(data) {
    const response = await api.post('/rooms/plans', data);
    return response.data;
  },

  async updatePlan(id, data) {
    const response = await api.put(`/rooms/plans/${id}`, data);
    return response.data;
  },

  async deletePlan(id) {
    const response = await api.delete(`/rooms/plans/${id}`);
    return response.data;
  }
};
