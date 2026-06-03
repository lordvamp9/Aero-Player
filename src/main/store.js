'use strict'

// Persistencia local en JSON mediante electron-store.
// Guarda configuracion, biblioteca escaneada, tokens de sesion y favoritos.
const Store = require('electron-store')

const store = new Store({
  name: 'aero-player',
  // Clave de cifrado ligero para los datos en disco (tokens, sesiones).
  encryptionKey: 'aero-glass-2024',
  defaults: {
    config: {
      visualizerMode: 'liquid',
      volume: 0.8,
      lastFolders: [],
    },
    library: [],
    favorites: [],
    auth: {
      google: null,
      spotify: null,
    },
  },
})

module.exports = { store }
