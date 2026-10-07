import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: the API is proxied, so the app only ever calls its own origin.
const backend = process.env.BACKEND_URL ?? 'http://127.0.0.1:8000' // not localhost: Node may resolve it to IPv6, Django listens on IPv4

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/media': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
})
