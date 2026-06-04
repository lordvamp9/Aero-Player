'use strict'

// Puente seguro entre el proceso principal y el renderer.
// Expone una API minima en window.aero sin habilitar nodeIntegration.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aero', {
  // Sistema de archivos / biblioteca local
  scanFolder: (folderPath) => ipcRenderer.invoke('scan-folder', folderPath),
  readMetadata: (filePath) => ipcRenderer.invoke('read-metadata', filePath),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),

  // Convierte una ruta local en una URL reproducible por <audio>/<video>.
  toMediaUrl: (filePath) => 'aeromedia://local/' + encodeURIComponent(filePath),

  // Autenticacion
  googleAuthStart: () => ipcRenderer.invoke('google-auth-start'),
  googleAuthLogout: () => ipcRenderer.invoke('google-auth-logout'),
  spotifyAuthStart: () => ipcRenderer.invoke('spotify-auth-start'),
  spotifyAuthLogout: () => ipcRenderer.invoke('spotify-auth-logout'),
  getAuthStatus: () => ipcRenderer.invoke('get-auth-status'),

  // YouTube Data API
  youtubeGetLiked: () => ipcRenderer.invoke('youtube-get-liked'),
  youtubeGetPlaylists: () => ipcRenderer.invoke('youtube-get-playlists'),
  youtubeGetPlaylistItems: (id) => ipcRenderer.invoke('youtube-get-playlist-items', id),
  youtubeSearchMusic: (q) => ipcRenderer.invoke('youtube-search-music', q),

  // Persistencia (electron-store)
  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),

  // Controles de ventana
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  onMaximizeChange: (cb) => ipcRenderer.on('window-maximize-change', (_e, isMax) => cb(isMax)),
})
