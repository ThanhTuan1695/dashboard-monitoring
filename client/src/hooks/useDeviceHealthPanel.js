import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { discoverDevice, setDeviceCredential, deleteDeviceCredential, getDeviceHealth, pollDeviceNow } from '../api/deviceMonitoring';

// Shared by every connector-monitored device type's health dialog (firewall,
// switch, ...) — the health/discover/poll/credential wiring never differs
// per type, only how the normalized payload gets rendered does.
export function useDeviceHealthPanel(device, open) {
  const queryClient = useQueryClient();

  const [discoverResult, setDiscoverResult] = useState(null);
  const [credType, setCredType] = useState('api_token');
  const [credFields, setCredFields] = useState({});
  const [error, setError] = useState('');

  const healthQuery = useQuery({
    queryKey: ['device-health', device?._id],
    queryFn: () => getDeviceHealth(device._id),
    enabled: open && Boolean(device),
  });

  const invalidateHealth = () => queryClient.invalidateQueries({ queryKey: ['device-health', device._id] });

  const discoverMutation = useMutation({
    mutationFn: () => discoverDevice(device._id),
    onSuccess: (data) => {
      setDiscoverResult(data);
      setError('');
    },
    onError: (err) => setError(err.response?.data?.error || 'Discovery failed'),
  });

  const pollMutation = useMutation({
    mutationFn: () => pollDeviceNow(device._id),
    onSuccess: () => {
      invalidateHealth();
      setError('');
    },
    onError: (err) => setError(err.response?.data?.error || 'Poll failed'),
  });

  const setCredMutation = useMutation({
    mutationFn: () => setDeviceCredential(device._id, { type: credType, ...credFields }),
    onSuccess: () => {
      setCredFields({});
      invalidateHealth();
      setError('');
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to save credential'),
  });

  const deleteCredMutation = useMutation({
    mutationFn: () => deleteDeviceCredential(device._id),
    onSuccess: invalidateHealth,
  });

  return {
    health: healthQuery.data,
    isLoading: healthQuery.isLoading,
    discoverResult,
    credType,
    setCredType,
    credFields,
    setCredFields,
    error,
    discoverMutation,
    pollMutation,
    setCredMutation,
    deleteCredMutation,
  };
}
