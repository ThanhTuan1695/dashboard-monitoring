import { api } from './client';

// Shared by every connector-monitored device type (firewall, switch, ...) —
// the routes and response shapes are generic; only the UI panel that renders
// the normalized health payload differs per type (FirewallHealthDialog vs
// SwitchHealthDialog).
export async function discoverDevice(id, credentials = {}) {
  const { data } = await api.post(`/devices/${id}/discover`, credentials);
  return data;
}

export async function setDeviceCredential(id, payload) {
  const { data } = await api.put(`/devices/${id}/credential`, payload);
  return data;
}

export async function deleteDeviceCredential(id) {
  const { data } = await api.delete(`/devices/${id}/credential`);
  return data;
}

export async function getDeviceHealth(id) {
  const { data } = await api.get(`/devices/${id}/health`);
  return data;
}

export async function pollDeviceNow(id, forceDiscovery = false) {
  const { data } = await api.post(`/devices/${id}/poll`, null, { params: { forceDiscovery } });
  return data;
}
