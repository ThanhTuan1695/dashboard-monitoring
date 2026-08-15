import { api } from './client';

export async function listDevices(params = {}) {
  const { data } = await api.get('/devices', { params });
  return data;
}

export async function getSummary(params = {}) {
  const { data } = await api.get('/devices/summary', { params });
  return data;
}

export async function createDevice(payload) {
  const { data } = await api.post('/devices', payload);
  return data;
}

export async function updateDevice(id, payload) {
  const { data } = await api.put(`/devices/${id}`, payload);
  return data;
}

export async function deleteDevice(id) {
  await api.delete(`/devices/${id}`);
}

export async function checkNow(id) {
  const { data } = await api.post(`/devices/${id}/check-now`);
  return data;
}

export async function getDeviceHistory(id, days = 30) {
  const { data } = await api.get(`/devices/${id}/history`, { params: { days } });
  return data;
}

export async function listDeviceGroups() {
  const { data } = await api.get('/devices/groups');
  return data;
}
