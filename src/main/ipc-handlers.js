'use strict'

// Registro central de todos los canales IPC entre el proceso principal y el
// renderer: sistema de archivos, autenticacion, persistencia y ventana.
const { ipcMain, dialog, BrowserWindow } = require('electron')
const { scanFolder } = require('./file-scanner')
const { readMetadata } = require('./metadata-reader')
const { store } = require('./store')
const { startGoogleAuth, logoutGoogle, getGoogleStatus } = require('./auth/google-auth')
const { startSpotifyAuth, logoutSpotify, getSpotifyStatus } = require('./auth/spotify-auth')

let registered = false

function registerIpcHandlers(mainWindow) {
  // Eventos de ventana se reconectan a la ventana actual en cada creacion.
  registerWindowEvents(mainWindow)
  if (registered) return
  registered = true

  // ---- Sistema de archivos / biblioteca local ----
  ipcMain.handle('scan-folder', async (_e, folderPath) => {
    try {
      return { ok: true, files: scanFolder(folderPath) }
    } catch (err) {
      return { ok: false, error: String(err.message || err), files: [] }
    }
  })

  ipcMain.handle('read-metadata', async (_e, filePath) => {
    return readMetadata(filePath)
  })

  ipcMain.handle('open-folder-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow
    const result = await dialog.showOpenDialog(win, {
      title: 'Selecciona una carpeta de musica',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    return { canceled: false, folderPath: result.filePaths[0] }
  })

  // ---- Autenticacion ----
  ipcMain.handle('google-auth-start', async () => {
    try {
      return await startGoogleAuth()
    } catch (err) {
      return { connected: false, error: String(err.message || err) }
    }
  })
  ipcMain.handle('google-auth-logout', async () => logoutGoogle())

  ipcMain.handle('spotify-auth-start', async () => {
    try {
      return await startSpotifyAuth()
    } catch (err) {
      return { connected: false, error: String(err.message || err) }
    }
  })
  ipcMain.handle('spotify-auth-logout', async () => logoutSpotify())

  ipcMain.handle('get-auth-status', async () => ({
    google: getGoogleStatus(),
    spotify: getSpotifyStatus(),
  }))

  // ---- Persistencia ----
  ipcMain.handle('store-get', async (_e, key) => store.get(key))
  ipcMain.handle('store-set', async (_e, key, value) => {
    store.set(key, value)
    return true
  })
}

function registerWindowEvents(win) {
  ipcMain.removeAllListeners('window-minimize')
  ipcMain.removeAllListeners('window-maximize')
  ipcMain.removeAllListeners('window-close')

  ipcMain.on('window-minimize', () => win && win.minimize())
  ipcMain.on('window-maximize', () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('window-close', () => win && win.close())

  if (win) {
    win.on('maximize', () => win.webContents.send('window-maximize-change', true))
    win.on('unmaximize', () => win.webContents.send('window-maximize-change', false))
  }
}

module.exports = { registerIpcHandlers }
