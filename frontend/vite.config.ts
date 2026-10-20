import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// В режиме разработки запросы /api проксируются на Go-бэкенд.
export default defineConfig({
  plugins: [react()],
  // three.js (3D-мозг) грузится отдельным чанком ~500 КБ — это ожидаемо
  build: { chunkSizeWarningLimit: 700 },
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.VITE_API_TARGET ?? 'http://localhost:8080',
    },
  },
})
