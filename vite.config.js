import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'

// Vite sirve la carpeta del renderer en desarrollo (hot reload) y genera
// el bundle estatico en /dist para que Tauri (o electron-builder) lo empaquete.
export default defineConfig(({ mode }) => {
  // Carga el .env de la raiz del proyecto (sin el filtro de prefijo VITE_) para
  // poder inyectar las credenciales OAuth en el shim de Tauri (window.aero).
  // En una app de escritorio el client_id no es secreto y Spotify usa PKCE.
  const env = loadEnv(mode, process.cwd(), '')
  const injected = {
    SPOTIFY_CLIENT_ID: env.SPOTIFY_CLIENT_ID || '',
    SPOTIFY_REDIRECT_URI: env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:3000/auth/spotify/callback',
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET || '',
    GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI || 'http://127.0.0.1:3000/auth/google/callback',
  }

  return {
    root: resolve(__dirname, 'src/renderer'),
    base: './',
    define: {
      __AERO_ENV__: JSON.stringify(injected),
    },
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
  }
})
