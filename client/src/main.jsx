import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@adminlte/react/css';
import 'bootstrap-icons/font/bootstrap-icons.css';
// Bootstrap's ESM build bundles every component (Modal, Dropdown, ...) into one
// module, so importing it here — even with no named imports — evaluates the
// whole thing and registers the document-level data-bs-toggle click handlers
// that Dropdown/etc. rely on. (The UMD `bootstrap.bundle.min.js` build doesn't
// reliably attach `window.bootstrap` once it's gone through Vite's ESM interop,
// so components needing imperative control — see useBootstrapModal — import
// named exports from 'bootstrap' directly instead of reading a global.)
import 'bootstrap';
import './index.css';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
