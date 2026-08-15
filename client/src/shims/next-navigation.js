// Stub for `next/navigation`, aliased in vite.config.js.
//
// @adminlte/react's barrel file (dist/index.js) unconditionally imports every
// component — including SidebarNav and CommandPalette, which call into
// next/navigation — even though this app only imports framework-agnostic
// pieces (SidebarBrand, SidebarNavItem, ...) and never renders those two.
// Without this alias, Vite can't resolve the bare `next/navigation` import at
// build time since Next.js isn't installed (this app uses React Router).
// These stubs are enough to satisfy the import; they're never actually
// exercised because SidebarNav/CommandPalette aren't rendered.
export function usePathname() {
  return typeof window !== 'undefined' ? window.location.pathname : '/';
}

export function useRouter() {
  return {
    push: (href) => window.location.assign(href),
    replace: (href) => window.location.replace(href),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => window.location.reload(),
  };
}
