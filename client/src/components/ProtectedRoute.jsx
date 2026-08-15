import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// App.jsx already gates on `user`/`loading` before this ever renders (needed
// so the AdminLTE shell isn't mounted for a logged-out visitor) — this only
// handles the admin-only routes (Users, Audit log).
export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { user } = useAuth();
  if (requireAdmin && user.role !== 'admin') return <Navigate to="/devices" replace />;
  return children;
}
