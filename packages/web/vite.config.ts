import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 35173,
    host: true,
    proxy: {
      // 백엔드 API 프록시
      '/api': {
        target: 'http://localhost:35001',
        changeOrigin: true,
      },
      // WebSocket 프록시
      '/ws': {
        target: 'ws://localhost:35001',
        ws: true,
      },
    },
  },
})
