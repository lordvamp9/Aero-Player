'use strict'

const { app } = require('electron')
const path = require('path')

// Carga las variables de entorno (.env) desde el directorio raiz de la app.
// En produccion process.cwd() no apunta al directorio de la app, asi que
// usamos app.getAppPath() para encontrar el .env empaquetado.
require('dotenv').config({ path: path.join(app.getAppPath(), '.env') })

const { BrowserWindow, protocol, net } = require('electron')
const { pathToFileURL } = require('url')
const { registerIpcHandlers } = require('./ipc-handlers')

// El servidor de desarrollo de Vite. En produccion se carga el bundle estatico.
const DEV_SERVER_URL = 'http://localhost:5173'
const isDev = !app.isPackaged

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

app.whenReady().then(() => {
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
