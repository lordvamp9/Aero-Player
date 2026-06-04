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

  // Spotify Web API
  spotifyGetToken: () => ipcRenderer.invoke('spotify-get-token'),
  spotifyGetSavedTracks: () => ipcRenderer.invoke('spotify-get-saved-tracks'),
  spotifyGetPlaylists: () => ipcRenderer.invoke('spotify-get-playlists'),
  spotifyGetSavedAlbums: () => ipcRenderer.invoke('spotify-get-saved-albums'),
  spotifyGetPlaylistTracks: (id) => ipcRenderer.invoke('spotify-get-playlist-tracks', id),
  spotifyGetAllPlaylistTracks: (id) => ipcRenderer.invoke('spotify-get-all-playlist-tracks', id),
  spotifyGetAlbumTracks: (id) => ipcRenderer.invoke('spotify-get-album-tracks', id),
  spotifySearchTracks: (q) => ipcRenderer.invoke('spotify-search-tracks', q),

  // YouTube paginacion completa para importar playlists
  youtubeGetAllPlaylistItems: (id) => ipcRenderer.invoke('youtube-get-all-playlist-items', id),

  // Playlists propias
  playlistsGetAll: () => ipcRenderer.invoke('playlists-get-all'),
  playlistsCreate: (data) => ipcRenderer.invoke('playlists-create', data),
  playlistsUpdate: (id, data) => ipcRenderer.invoke('playlists-update', id, data),
  playlistsDelete: (id) => ipcRenderer.invoke('playlists-delete', id),
  playlistsAddTrack: (id, track) => ipcRenderer.invoke('playlists-add-track', id, track),
  playlistsAddBulk: (id, tracks) => ipcRenderer.invoke('playlists-add-bulk', id, tracks),
  playlistsRemoveTrack: (id, trackId) => ipcRenderer.invoke('playlists-remove-track', id, trackId),
  playlistsReorder: (id, from, to) => ipcRenderer.invoke('playlists-reorder', id, from, to),
  playlistsMoveEdge: (id, trackId, edge) => ipcRenderer.invoke('playlists-move-edge', id, trackId, edge),
  openImageDialog: () => ipcRenderer.invoke('open-image-dialog'),

  // Persistencia (electron-store)
  storeGet: (key) => ipcRenderer.invoke('store-get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),

  // Controles de ventana
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  onMaximizeChange: (cb) => ipcRenderer.on('window-maximize-change', (_e, isMax) => cb(isMax)),
})
