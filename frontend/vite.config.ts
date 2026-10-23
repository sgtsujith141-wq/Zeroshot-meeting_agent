import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The API runs separately (FastAPI on :8000). In dev, /api is proxied so the
// browser only talks to one origin and no secret is bundled into the client.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
    // The New meeting page bundles the synthetic demo transcript from ../demo.
    fs: { allow: ['.', '../demo'] },
  },
})
