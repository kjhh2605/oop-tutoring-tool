import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = `http://localhost:${process.env.PORT ?? 3000}`

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    host: true,
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': backend,
      '/collab': { target: backend.replace('http', 'ws'), ws: true },
    },
  },
})
