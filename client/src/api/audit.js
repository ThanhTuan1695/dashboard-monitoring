import { api } from './client';

export async function listAuditLog(params = {}) {
  const { data } = await api.get('/audit', { params });
  return data;
}
