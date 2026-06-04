'use strict'

const { app } = require('electron')
const path = require('path')

// Carga las variables de entorno (.env) desde el directorio raiz de la app.
// En produccion process.cwd() no apunta al directorio de la app, asi que
// usamos app.getAppPath() para encontrar el .env empaquetado.
require('dotenv').config({ path: path.join(app.getAppPath(), '.env') })

const { BrowserWindow, protocol, net, components, session, desktopCapturer } = require('electron')
const { pathToFileURL } = require('url')
const { registerIpcHandlers } = require('./ipc-handlers')

// El servidor de desarrollo de Vite. En produccion se carga el bundle estatico.
const DEV_SERVER_URL = 'http://localhost:5173'
const isDev = !app.isPackaged

// Identificador unico de la app en Windows. Necesario para que la barra de
// tareas y Alt+Tab usen el icono y el nombre correcto en lugar de "electron".
// Debe coincidir con el appId de electron-builder.config.js.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.aeroplayer.app')
}

// Resolucion del icono de la ventana. En Windows preferimos el .ico
// multi-resolucion; en Linux/macOS usamos el PNG.
const WINDOW_ICON = path.join(
  __dirname,
  '..',
  '..',
  'build',
  process.platform === 'win32' ? 'icon.ico' : 'icon.png'
)

let mainWindow = null

// Esquema privilegiado para servir archivos locales de audio/video con soporte
// de "range requests" (necesario para hacer scrubbing en la barra de progreso).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'aeromedia',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true },
  },
])

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 620,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#030712',
    icon: WINDOW_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  })

  // Conecta todos los canales IPC con esta ventana.
  registerIpcHandlers(mainWindow)

  if (isDev) {
    loadDevServerWithRetry(mainWindow)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// En desarrollo Electron puede arrancar antes que Vite. Reintentamos la carga
// hasta que el servidor responda, asi `npm run dev` nunca falla por una carrera.
function loadDevServerWithRetry(win) {
  win.loadURL(DEV_SERVER_URL).catch(() => {})
  win.webContents.on('did-fail-load', () => {
    setTimeout(() => {
      if (!win.isDestroyed()) win.loadURL(DEV_SERVER_URL).catch(() => {})
    }, 600)
  })
}

app.whenReady().then(async () => {
  // Inicializa el modulo Widevine de castlabs (necesario para que el SDK de
  // Spotify Web Playback pueda reproducir contenido protegido con DRM).
  // En la primera ejecucion descarga el componente CDM; si falla, la app sigue
  // funcionando con local y YouTube.
  global.widevineReady = false
  global.widevineError = null
  if (components && components.whenReady) {
    try {
      await components.whenReady()
      const status = components.status && components.status()
      console.log('[widevine] status:', JSON.stringify(status))
      // El status devuelve un objeto con cada componente. Verificamos que
      // realmente exista "Widevine Content Decryption Module" registrado.
      const found = status && Object.keys(status).some((k) => /widevine/i.test(k))
      global.widevineReady = !!found
      if (!found) {
        global.widevineError = 'Widevine no se registro despues de components.whenReady()'
        console.warn('[widevine] no se registro ningun keysystem. status=', status)
      }
    } catch (err) {
      global.widevineError = String((err && err.message) || err)
      console.warn('[widevine] error en components.whenReady:', err)
    }
  } else {
    global.widevineError = 'Esta build de Electron no expone "components". Necesitas el build de castlabs.'
    console.warn('[widevine] components no disponible en esta build de Electron')
  }

  // Autoriza la captura de audio del sistema (loopback) para el visualizador.
  // Esto permite que las barras y las ondas reaccionen al audio real cuando
  // suena Spotify o YouTube (que no pasan por nuestro elemento <audio>).
  // Se entrega siempre la primera pantalla disponible como "video stub" y
  // se solicita loopback de audio; en el renderer descartamos la pista
  // de video y solo conectamos el audio al AnalyserNode.
  if (session.defaultSession.setDisplayMediaRequestHandler) {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          if (sources && sources.length) {
            callback({ video: sources[0], audio: 'loopback' })
          } else {
            callback({})
          }
        })
        .catch(() => callback({}))
    })
  }

  // Sirve los archivos locales solicitados con el esquema aeromedia://
  protocol.handle('aeromedia', (request) => {
    const raw = request.url.slice('aeromedia://'.length)
    // El renderer envia la ruta como host+path codificada en URI.
    const decoded = decodeURIComponent(raw.replace(/^\/+/, ''))
    return net.fetch(pathToFileURL(decoded).toString())
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
