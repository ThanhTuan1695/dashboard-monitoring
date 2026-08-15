import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // @adminlte/react's barrel file imports every component (including
      // Next.js-only ones this app never renders) — see src/shims/next-navigation.js.
      'next/navigation': fileURLToPath(new URL('./src/shims/next-navigation.js', import.meta.url)),
    },
  },
})
