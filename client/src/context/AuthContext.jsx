import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { login as loginApi, fetchMe } from '../api/auth';
import { setUnauthorizedHandler } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setUser(null);
  }, []);

  // Any 401 from the API (expired/invalid token) logs the user out automatically.
  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  // On first load, if a token is already stored, validate it against /auth/me.
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    fetchMe()
      .then(setUser)
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout]);

  const login = async (username, password) => {
    const { token, user: loggedInUser } = await loginApi(username, password);
    localStorage.setItem('token', token);
    setUser(loggedInUser);
    return loggedInUser;
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
