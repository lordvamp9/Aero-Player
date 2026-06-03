import { defineConfig } from 'vite'
import { resolve } from 'path'

// Vite sirve la carpeta del renderer en desarrollo (hot reload) y genera
// el bundle estatico en /dist para que electron-builder lo empaquete.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
    },
  },
})
