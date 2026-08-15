import { useEffect } from 'react';
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  SidebarProvider,
  useSidebarContext,
  LinkProvider,
  SidebarBrand,
  SidebarNavItem,
  SidebarOverlay,
  Footer,
  Dropdown,
  Spinner,
} from '@adminlte/react';

import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/UsersPage';
import GroupsPage from './pages/GroupsPage';
import AuditLogPage from './pages/AuditLogPage';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';
import { DEVICE_TYPES } from './config/deviceTypeDefaults';

// @adminlte/react's Sidebar/SidebarNav hard-import `usePathname` from
// next/navigation, so they can't be used outside Next.js. SidebarNavItem
// itself is framework-agnostic (takes `currentPath` as a plain prop), so the
// sidebar shell below is hand-assembled from that + SidebarBrand/SidebarOverlay.
function RouterLink({ href, children, ...rest }) {
  return (
    <Link to={href} {...rest}>
      {children}
    </Link>
  );
}

function buildMenuItems(role) {
  const items = [
    { type: 'item', text: 'All Devices', href: '/devices', icon: 'bi-grid' },
    ...DEVICE_TYPES.map((t) => ({ type: 'item', text: t.navLabel, href: `/devices/${t.value}`, icon: t.icon })),
  ];
  if (role === 'admin') {
    items.push({ type: 'header', text: 'ADMIN' });
    items.push({ type: 'item', text: 'Users', href: '/users', icon: 'bi-people' });
    items.push({ type: 'item', text: 'Groups', href: '/groups', icon: 'bi-collection' });
    items.push({ type: 'item', text: 'Audit log', href: '/audit', icon: 'bi-clipboard-data' });
  }
  return items;
}

function Topbar() {
  const { user, logout } = useAuth();
  const { toggle } = useSidebarContext();
  const navigate = useNavigate();

  return (
    <nav className="app-header navbar navbar-expand bg-body">
      <div className="container-fluid">
        <ul className="navbar-nav">
          <li className="nav-item">
            <button type="button" className="nav-link" onClick={toggle} aria-label="Toggle sidebar">
              <i className="bi bi-list"></i>
            </button>
          </li>
        </ul>
        <ul className="navbar-nav ms-auto">
          <Dropdown
            label={
              <>
                <i className="bi bi-person-circle me-1"></i>
                {user.username} ({user.role})
              </>
            }
            variant="outline"
            theme="secondary"
            size="sm"
            align="end"
            items={[
              {
                label: (
                  <>
                    <i className="bi bi-box-arrow-right me-2"></i>
                    Log out
                  </>
                ),
                onClick: () => {
                  logout();
                  navigate('/login');
                },
              },
            ]}
          />
        </ul>
      </div>
    </nav>
  );
}

function AppShell({ children }) {
  const { user } = useAuth();
  const location = useLocation();

  // Mirrors how @adminlte/react's own AuthLayout scopes its body classes to
  // an effect — keeps the authenticated shell and the standalone login page
  // from fighting over <body>'s class list.
  useEffect(() => {
    const classes = ['layout-fixed', 'sidebar-expand-lg', 'bg-body-tertiary'];
    document.body.classList.add(...classes);
    return () => document.body.classList.remove(...classes);
  }, []);

  const menuItems = buildMenuItems(user.role);

  return (
    <SidebarProvider enablePersistence>
      <LinkProvider component={RouterLink}>
        <div className="app-wrapper">
          <Topbar />
          <aside className="app-sidebar bg-body-secondary shadow" data-bs-theme="dark">
            <SidebarBrand href="/devices" logo={<>Device Monitoring</>} />
            <div className="sidebar-wrapper">
              <nav className="mt-2" aria-label="Main navigation">
                <ul className="nav sidebar-menu flex-column">
                  {menuItems.map((item, idx) => (
                    <SidebarNavItem
                      key={idx}
                      item={item}
                      // SidebarNavItem treats any path starting with `${item.href}/` as active too —
                      // correct for the type-specific links, but it means "All Devices" (href
                      // `/devices`) would also light up on every `/devices/:type` sub-route. Blank
                      // out its currentPath there so only the exact match still applies.
                      currentPath={item.href === '/devices' && location.pathname !== '/devices' ? '' : location.pathname}
                    />
                  ))}
                </ul>
              </nav>
            </div>
          </aside>
          <SidebarOverlay />
          <main className="app-main">{children}</main>
          <Footer />
        </div>
      </LinkProvider>
    </SidebarProvider>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100">
        <Spinner theme="primary" label="Loading…" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/login" element={<Navigate to="/devices" replace />} />
        <Route path="/devices" element={<DashboardPage />} />
        <Route path="/devices/:type" element={<DashboardPage />} />
        <Route
          path="/users"
          element={
            <ProtectedRoute requireAdmin>
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/groups"
          element={
            <ProtectedRoute requireAdmin>
              <GroupsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit"
          element={
            <ProtectedRoute requireAdmin>
              <AuditLogPage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/devices" replace />} />
        <Route path="*" element={<Navigate to="/devices" replace />} />
      </Routes>
    </AppShell>
  );
}
