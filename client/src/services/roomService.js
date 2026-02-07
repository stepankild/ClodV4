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

  async getPlans(params = {}) {
    const response = await api.get('/rooms/plans', { params });
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
  },

  async addNote(roomId, note) {
    const response = await api.post(`/rooms/${roomId}/note`, { note });
    return response.data;
  },

  async quickTask(roomId, { type, product, dosage }) {
    const response = await api.post('/tasks/quick', { roomId, type, product, dosage });
    return response.data;
  },

  async deleteTask(taskId) {
    const response = await api.delete(`/tasks/${taskId}`);
    return response.data;
  },

  async getRoomTasks(roomId) {
    const response = await api.get(`/tasks/room/${roomId}`);
    return response.data;
  }
};
