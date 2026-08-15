import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

/**
 * Subscribes to the backend's live status/CRUD events and invalidates the
 * relevant React Query caches so the dashboard updates without polling.
 * The socket authenticates with the same JWT as the REST API.
 */
export function useDeviceSocket() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return; // not logged in — this hook is only used on the authenticated dashboard anyway

    const socket = io(API_BASE_URL, { transports: ['websocket', 'polling'], auth: { token } });

    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
    };

    socket.on('device:status-changed', refresh);
    socket.on('device:updated', refresh);
    socket.on('device:created', refresh);
    socket.on('device:deleted', refresh);

    return () => socket.disconnect();
  }, [queryClient]);
}
