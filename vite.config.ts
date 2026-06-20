import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Standalone MAE/MFE dashboard. Price data + all computation run in the
// browser. Persistence goes to the lightweight SQLite backend when it's
// running (proxied below); otherwise the app falls back to localStorage.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5185,
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  // `npm run preview` (serving the production build) proxies /api too, so the
  // built app can talk to the SQLite backend exactly like the dev server.
  preview: {
    port: 5185,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
