import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 (vite's default) belongs to questions-factory-frontend on this machine;
    // strictPort makes the testbed fail loudly instead of silently drifting back there.
    port: 5500,
    strictPort: true,
  },
})
