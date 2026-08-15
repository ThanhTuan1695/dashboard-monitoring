import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthLayout, Input, Button, Alert } from '@adminlte/react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) navigate(location.state?.from || '/devices', { replace: true });
  }, [user, navigate, location.state]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout authType="login" logo="Device Monitoring">
      <p className="login-box-msg">Sign in to start monitoring</p>
      {error && <Alert theme="danger">{error}</Alert>}
      <form onSubmit={handleSubmit}>
        <Input
          name="username"
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          required
        />
        <Input
          name="password"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Button type="submit" theme="primary" className="w-100" disabled={submitting} label={submitting ? 'Signing in…' : 'Sign in'} />
      </form>
    </AuthLayout>
  );
}
