'use strict'

// Registro central de todos los canales IPC entre el proceso principal y el
// renderer: sistema de archivos, autenticacion, persistencia y ventana.
const { ipcMain, dialog, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const { scanFolder } = require('./file-scanner')
const { readMetadata } = require('./metadata-reader')
const { store } = require('./store')
const { startGoogleAuth, logoutGoogle, getGoogleStatus } = require('./auth/google-auth')
const { startSpotifyAuth, logoutSpotify, getSpotifyStatus } = require('./auth/spotify-auth')
const { getLikedVideos, getMyPlaylists, getPlaylistItems, getAllPlaylistItems, searchMusic } = require('./youtube-api')
const spotifyApi = require('./spotify-api')
const playlists = require('./playlists-store')

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

  // ---- YouTube Data API ----
  ipcMain.handle('youtube-get-liked', async () => getLikedVideos())
  ipcMain.handle('youtube-get-playlists', async () => getMyPlaylists())
  ipcMain.handle('youtube-get-playlist-items', async (_e, playlistId) => getPlaylistItems(playlistId))
  ipcMain.handle('youtube-search-music', async (_e, query) => searchMusic(query))

  // ---- Spotify Web API ----
  ipcMain.handle('spotify-get-token', async () => spotifyApi.getValidToken())
  ipcMain.handle('spotify-get-saved-tracks', async () => spotifyApi.getSavedTracks())
  ipcMain.handle('spotify-get-playlists', async () => spotifyApi.getPlaylists())
  ipcMain.handle('spotify-get-saved-albums', async () => spotifyApi.getSavedAlbums())
  ipcMain.handle('spotify-get-playlist-tracks', async (_e, id) => spotifyApi.getPlaylistTracks(id))
  ipcMain.handle('spotify-get-all-playlist-tracks', async (_e, id) => spotifyApi.getAllPlaylistTracks(id))
  ipcMain.handle('spotify-get-album-tracks', async (_e, id) => spotifyApi.getAlbumTracks(id))
  ipcMain.handle('spotify-search-tracks', async (_e, q) => spotifyApi.searchTracks(q))

  // ---- YouTube: paginacion completa para importar playlists enteras ----
  ipcMain.handle('youtube-get-all-playlist-items', async (_e, id) => getAllPlaylistItems(id))

  // ---- Playlists propias ----
  ipcMain.handle('playlists-get-all', async () => playlists.getAll())
  ipcMain.handle('playlists-create', async (_e, data) => playlists.create(data || {}))
  ipcMain.handle('playlists-update', async (_e, id, data) => playlists.update(id, data || {}))
  ipcMain.handle('playlists-delete', async (_e, id) => playlists.remove(id))
  ipcMain.handle('playlists-add-track', async (_e, id, track) => playlists.addTrack(id, track))
  ipcMain.handle('playlists-add-bulk', async (_e, id, tracks) => playlists.addTracksBulk(id, tracks))
  ipcMain.handle('playlists-remove-track', async (_e, id, trackId) => playlists.removeTrack(id, trackId))
  ipcMain.handle('playlists-reorder', async (_e, id, from, to) => playlists.reorder(id, from, to))
  ipcMain.handle('playlists-move-edge', async (_e, id, trackId, edge) => playlists.moveTrackToEdge(id, trackId, edge))

  // ---- Dialogo nativo de imagen (devuelve base64) ----
  ipcMain.handle('open-image-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow
    const result = await dialog.showOpenDialog(win, {
      title: 'Selecciona una imagen de portada',
      properties: ['openFile'],
      filters: [{ name: 'Imagenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    })
    if (result.canceled || !result.filePaths.length) return { canceled: true }
    try {
      const filePath = result.filePaths[0]
      const buf = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase().slice(1)
      const mime = ext === 'jpg' ? 'jpeg' : ext
      const base64 = `data:image/${mime};base64,${buf.toString('base64')}`
      return { canceled: false, path: filePath, base64 }
    } catch (err) {
      return { canceled: false, error: String(err.message || err) }
    }
  })

  // ---- Estado de Widevine (DRM necesario para Spotify Web Playback) ----
  ipcMain.handle('get-widevine-status', async () => ({
    ready: !!global.widevineReady,
    error: global.widevineError || null,
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
