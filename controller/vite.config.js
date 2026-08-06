import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: parseInt(process.env.PORT ?? '5173'),
    https: {
      key: fs.readFileSync(path.resolve(__dirname, '../gateway/certs/server.key')),
      cert: fs.readFileSync(path.resolve(__dirname, '../gateway/certs/server.cert')),
    },
    proxy: {
      '/api': {
        target: 'https://localhost:8080',
        changeOrigin: true,
        secure: false, // Bỏ qua lỗi tự ký SSL trong Dev
      },
      '/controller': {
        target: 'wss://localhost:8080',
        ws: true,
        changeOrigin: true,
        secure: false, // Bỏ qua lỗi tự ký WSS trong Dev
      },
    },
  },
})
