/* =====================================================================
   AERO PLAYER  ·  app.js
   Inicializacion, estado global compartido, bus de eventos, controles de
   ventana, busqueda global y sistema de notificaciones toast.
   ===================================================================== */

import { initPlayer } from './player.js'
import { initVisualizer } from './visualizer.js'
import { initQueue } from './queue.js'
import { initLibrary } from './library.js'
import { initSidebar } from './sidebar.js'
import { initYouTube, searchYouTube } from './youtube.js'
import { initSpotify, searchSpotify } from './spotify.js'
import { initDragDrop } from './drag-drop.js'
import { initPlaylists } from './playlists.js'
import { initSettings } from './settings.js'
import { initProfile } from './profile.js'

// El puente seguro expuesto desde preload.js. Si no existe (por ejemplo al
// abrir el HTML fuera de Electron) se usa un stub para no romper la UI.
const aero = window.aero || stubBridge()

// ---------------------------------------------------------------------
// Contexto compartido por todos los modulos
// ---------------------------------------------------------------------
const bus = new EventTarget()

const ctx = {
  aero,
  bus,
  on(name, cb) {
    bus.addEventListener(name, (e) => cb(e.detail))
  },
  emit(name, detail) {
    bus.dispatchEvent(new CustomEvent(name, { detail }))
  },
  state: {
    queue: [], // cola manual (solo lo que el usuario agrega explicitamente)
    currentTrack: null, // pista en reproduccion (no necesariamente en la cola)
    context: null, // { list, index } lista desde la que se reproduce (siguiente/anterior)
    currentId: null,
    isPlaying: false,
    volume: 0.8,
    muted: false,
    repeat: 'off', // off | all | one
    shuffle: false,
    visualizerMode: 'liquid',
    library: [],
    favorites: [],
    auth: { google: { connected: false }, spotify: { connected: false } },
  },
  els: {},
  toast,
}

// Hace accesible el contexto desde la consola para depuracion.
window.AeroApp = ctx

// ---------------------------------------------------------------------
// Cache de elementos del DOM
// ---------------------------------------------------------------------
function cacheElements() {
  const id = (x) => document.getElementById(x)
  ctx.els = {
    appWindow: id('app-window'),
    // Ventana
    btnMin: id('btn-min'),
    btnMax: id('btn-max'),
    btnClose: id('btn-close'),
    // Busqueda
    search: id('global-search'),
    // Escenario
    canvas: id('visualizer'),
    nowPlaying: id('now-playing-view'),
    npCover: id('np-cover'),
    npTitle: id('np-title'),
    npArtist: id('np-artist'),
    listView: id('list-view'),
    listViewTitle: id('list-view-title'),
    listViewCount: id('list-view-count'),
    listViewBody: id('list-view-body'),
    listViewClose: id('list-view-close'),
    vizSelector: id('viz-selector'),
    // Player
    progressRail: id('progress-rail'),
    progressFill: id('progress-fill'),
    progressKnob: id('progress-knob'),
    timeCurrent: id('time-current'),
    timeTotal: id('time-total'),
    btnShuffle: id('btn-shuffle'),
    btnPrev: id('btn-prev'),
    btnPlay: id('btn-play'),
    btnNext: id('btn-next'),
    btnRepeat: id('btn-repeat'),
    btnMute: id('btn-mute'),
    volIcon: id('vol-icon-svg'),
    volumeRail: id('volume-rail'),
    volumeFill: id('volume-fill'),
    volumeKnob: id('volume-knob'),
    npMiniCover: id('np-mini-cover'),
    npMiniTitle: id('np-mini-title'),
    npMiniArtist: id('np-mini-artist'),
    iconPlay: document.querySelector('.icon-play'),
    iconPause: document.querySelector('.icon-pause'),
    audio: id('audio-element'),
    // Cola
    queueList: id('queue-list'),
    queueCount: id('queue-count'),
    queueEmpty: id('queue-empty'),
    // Estado
    statusLeft: id('status-left'),
    statusCenter: id('status-center'),
    statusRight: id('status-right'),
    // Otros
    toastContainer: id('toast-container'),
    contextMenu: id('context-menu'),
  }
}

// ---------------------------------------------------------------------
// Controles de ventana
// ---------------------------------------------------------------------
function wireWindowControls() {
  ctx.els.btnMin.addEventListener('click', () => aero.windowMinimize())
  ctx.els.btnMax.addEventListener('click', () => aero.windowMaximize())
  ctx.els.btnClose.addEventListener('click', () => aero.windowClose())
  if (aero.onMaximizeChange) {
    aero.onMaximizeChange((isMax) => {
      const glyph = ctx.els.btnMax.querySelector('.win-glyph')
      // Doble cuadro cuando esta maximizada, cuadro simple cuando no.
      glyph.innerHTML = isMax ? '&#x2750;' : '&#x25A1;'
    })
  }
}

// ---------------------------------------------------------------------
// Busqueda global (biblioteca + playlists)
// ---------------------------------------------------------------------
function wireSearch() {
  let t
  let lastPlatformOrder = ['youtube', 'spotify'] // alternancia
  ctx.els.search.addEventListener('input', (e) => {
    clearTimeout(t)
    const term = e.target.value.trim()
    t = setTimeout(() => {
      ctx.emit('search', term)
      if (term.length >= 2) runHybridSearch(term, lastPlatformOrder)
    }, 320)
  })
}

// Lanza busqueda paralela en YouTube y Spotify (si hay sesion) y unifica.
async function runHybridSearch(term, order) {
  const ytConnected = ctx.state.auth.google.connected
  const spConnected = ctx.state.auth.spotify.connected
  if (!ytConnected && !spConnected) return

  // Estado de carga: indica que esta buscando en ambas fuentes.
  showSearchLoading(term, ytConnected, spConnected)

  const ytPromise = ytConnected
    ? ctx.aero.youtubeSearchMusic(term).catch(() => ({ ok: false, items: [] }))
    : Promise.resolve({ ok: false, items: [] })
  const spPromise = spConnected
    ? ctx.aero.spotifySearchTracks(term).catch(() => ({ ok: false, items: [] }))
    : Promise.resolve({ ok: false, items: [] })

  const [ytRes, spRes] = await Promise.allSettled([ytPromise, spPromise])
  const ytItems = (ytRes.status === 'fulfilled' && ytRes.value.items) || []
  const spItems = (spRes.status === 'fulfilled' && spRes.value.items) || []

  // Maximo 10 de cada lado, alternados (Spotify primero por defecto).
  const ytTop = ytItems.slice(0, 10)
  const spTop = spItems.slice(0, 10)
  const merged = interleave(spTop, ytTop)
  renderHybridResults(term, merged, ytTop.length, spTop.length)
}

function interleave(a, b) {
  const out = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    if (a[i]) out.push(a[i])
    if (b[i]) out.push(b[i])
  }
  return out
}

function showSearchLoading(term, ytConnected, spConnected) {
  const sources = []
  if (spConnected) sources.push('Spotify')
  if (ytConnected) sources.push('YouTube')
  ctx.els.listViewTitle.textContent = `Buscando "${term}"`
  ctx.els.listViewCount.textContent = sources.length ? `en ${sources.join(' y ')}...` : ''
  ctx.els.listViewBody.innerHTML = '<div class="list-empty">Buscando...</div>'
  ctx.els.listView.querySelector('.list-view-head').style.display = ''
  ctx.els.listView.hidden = false
  ctx.els.nowPlaying.style.opacity = '0.15'
}

function renderHybridResults(term, items, ytCount, spCount) {
  ctx.els.listViewTitle.textContent = `Resultados para "${term}"`
  ctx.els.listViewCount.textContent = items.length
    ? `${spCount} Spotify · ${ytCount} YouTube`
    : 'Sin resultados'
  ctx.els.listViewBody.innerHTML = ''

  if (!items.length) {
    ctx.els.listViewBody.innerHTML =
      '<div class="list-empty">Sin resultados. Conecta YouTube o Spotify para ampliar la busqueda.</div>'
    return
  }

  const frag = document.createDocumentFragment()
  items.forEach((item, i) => {
    const row = document.createElement('div')
    row.className = 'track-row'
    if (item.id === ctx.state.currentId) row.classList.add('active')
    const cover = item.coverUrl ? `background-image:url('${item.coverUrl}')` : ''
    row.innerHTML = `
      <span class="tr-index">${i + 1}</span>
      <span class="tr-platform">${platformIcon(item.source, 16)}</span>
      <span class="tr-cover" style="${cover}">${item.coverUrl ? '' : platformIcon(item.source, 14)}</span>
      <span class="tr-main">
        <span class="tr-title">${escapeHtml(item.title)}</span>
        <span class="tr-sub">${escapeHtml(item.artist)}</span>
      </span>
      <span class="tr-album">${escapeHtml(item.album || '')}</span>
      <span class="tr-dur">${item.durationFormatted || ''}</span>
    `
    row.addEventListener('click', () => {
      ctx.player.playItem(item, { list: items, index: i })
    })
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      ctx.contextMenu.show(e.clientX, e.clientY, [
        { label: 'Reproducir ahora', action: () => ctx.player.playItem(item, { list: items, index: i }) },
        { label: 'Agregar a la cola', action: () => ctx.queue.add({ ...item }) },
        { sep: true },
        ctx.playlists.showAddToPlaylistSubmenuItems(item),
      ])
    })
    frag.appendChild(row)
  })
  ctx.els.listViewBody.appendChild(frag)
}

// ---------------------------------------------------------------------
// Notificaciones toast (maximo 3 visibles, 3s con fade out)
// ---------------------------------------------------------------------
function toast(message, opts = {}) {
  const container = ctx.els.toastContainer
  if (!container) return null
  while (container.children.length >= 3) container.removeChild(container.firstChild)

  const el = document.createElement('div')
  el.className = 'toast' + (opts.progress ? ' toast-progress' : '')

  let iconHtml = ''
  if (opts.progress) {
    iconHtml = '' // el CSS dibuja el spinner
  } else if (opts.platform === 'youtube') iconHtml = ytIcon(15)
  else if (opts.platform === 'spotify') iconHtml = spIcon(15)
  else iconHtml = infoIcon()

  el.innerHTML = `<span class="toast-icon">${iconHtml}</span><span class="toast-text">${escapeHtml(
    message
  )}</span>`
  container.appendChild(el)

  const timer = setTimeout(() => {
    el.classList.add('leaving')
    setTimeout(() => el.remove(), 320)
  }, opts.duration || 3000)

  return {
    remove() {
      clearTimeout(timer)
      el.classList.add('leaving')
      setTimeout(() => el.remove(), 320)
    },
  }
}

// ---------------------------------------------------------------------
// Barra de estado
// ---------------------------------------------------------------------
function updateStatusBar() {
  const q = ctx.state.queue
  const sources = new Set(q.map((i) => i.source))
  const total = q.reduce((acc, i) => acc + (i.duration || 0), 0)
  ctx.els.statusLeft.textContent = `Cola: ${q.length} ${
    q.length === 1 ? 'cancion' : 'canciones'
  } · ${sources.size} ${sources.size === 1 ? 'fuente' : 'fuentes'} · ${formatTime(
    total
  )} duracion total`
}

ctx.updateStatusBar = updateStatusBar

// ---------------------------------------------------------------------
// Persistencia: carga config y biblioteca guardadas
// ---------------------------------------------------------------------
async function loadPersisted() {
  try {
    const config = await aero.storeGet('config')
    if (config) {
      if (typeof config.volume === 'number') ctx.state.volume = config.volume
      if (config.visualizerMode) ctx.state.visualizerMode = config.visualizerMode
    }
    const lib = await aero.storeGet('library')
    if (Array.isArray(lib)) ctx.state.library = lib
    const fav = await aero.storeGet('favorites')
    if (Array.isArray(fav)) ctx.state.favorites = fav
  } catch {
    /* primera ejecucion sin datos */
  }
}

ctx.persist = {
  config() {
    aero.storeSet('config', {
      volume: ctx.state.volume,
      visualizerMode: ctx.state.visualizerMode,
    })
  },
  library() {
    aero.storeSet('library', ctx.state.library)
  },
  favorites() {
    aero.storeSet('favorites', ctx.state.favorites)
  },
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
async function boot() {
  cacheElements()
  await loadPersisted()

  wireWindowControls()
  wireSearch()

  // Inicializa cada subsistema con el contexto compartido.
  initVisualizer(ctx)
  initPlayer(ctx)
  initQueue(ctx)
  initLibrary(ctx)
  initYouTube(ctx)
  initSpotify(ctx)
  initSidebar(ctx)
  initDragDrop(ctx)
  initPlaylists(ctx)
  initSettings(ctx)
  await initProfile(ctx)

  updateStatusBar()
  ctx.emit('queue-changed')
  ctx.els.statusCenter.textContent = 'Aero Player listo'

  // El visualizador arranca en modo demo de inmediato.
  ctx.visualizer.start()
}

document.addEventListener('DOMContentLoaded', boot)

// ---------------------------------------------------------------------
// Utilidades compartidas
// ---------------------------------------------------------------------
export function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c])
}

export function ytIcon(size = 16) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`
}

export function spIcon(size = 16) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="#1DB954" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`
}

export function localIcon(size = 14) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="rgba(140,195,255,.85)" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>`
}

export function platformIcon(source, size = 16) {
  if (source === 'youtube') return ytIcon(size)
  if (source === 'spotify') return spIcon(size)
  return localIcon(size)
}

function infoIcon() {
  return `<svg viewBox="0 0 24 24" width="15" height="15"><circle cx="12" cy="12" r="10" fill="none" stroke="rgba(120,190,255,.9)" stroke-width="2"/><path fill="rgba(120,190,255,.9)" d="M11 10h2v7h-2zM11 6.5h2v2h-2z"/></svg>`
}

// Stub del bridge para previsualizar la UI fuera de Electron.
function stubBridge() {
  return {
    scanFolder: async () => ({ ok: false, files: [] }),
    readMetadata: async () => ({}),
    openFolderDialog: async () => ({ canceled: true }),
    toMediaUrl: (p) => 'file://' + p,
    googleAuthStart: async () => ({ connected: false, error: 'Disponible solo en la app de escritorio.' }),
    googleAuthLogout: async () => ({ connected: false }),
    spotifyAuthStart: async () => ({ connected: false, error: 'Disponible solo en la app de escritorio.' }),
    spotifyAuthLogout: async () => ({ connected: false }),
    getAuthStatus: async () => ({ google: { connected: false }, spotify: { connected: false } }),
    storeGet: async () => null,
    storeSet: async () => true,
    windowMinimize() {},
    windowMaximize() {},
    windowClose() {},
    onMaximizeChange() {},
  }
}
