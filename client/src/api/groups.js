import { api } from './client';

export async function listGroups() {
  const { data } = await api.get('/groups');
  return data;
}

export async function createGroup(payload) {
  const { data } = await api.post('/groups', payload);
  return data;
}

export async function updateGroup(id, payload) {
  const { data } = await api.put(`/groups/${id}`, payload);
  return data;
}

export async function deleteGroup(id) {
  const { data } = await api.delete(`/groups/${id}`);
  return data;
}
