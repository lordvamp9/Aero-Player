/* =====================================================================
   AERO PLAYER  ·  youtube.js
   Reproduccion con YouTube IFrame API y carga real de contenido via
   YouTube Data API v3 (liked videos, playlists, busqueda musical).
   ===================================================================== */

import { escapeHtml, ytIcon } from './app.js'

let ctx
let player = null
let ready = false
let pendingVideoId = null
let playlistCache = null // cache de playlists del usuario

export function initYouTube(context) {
  ctx = context

  ctx.youtube = {
    connect,
    logout,
    loadSection,
    play,
    pause,
    resume,
    stop,
    seek,
    getTimes,
    setVolume,
    setMuted,
    isPlaying,
  }

  loadIframeApi()
}

// 1 = PLAYING, 3 = BUFFERING (lo tratamos como "sonando").
function isPlaying() {
  if (!ready || !player || !player.getPlayerState) return null
  const s = player.getPlayerState()
  return s === 1 || s === 3
}

// ---------------------------------------------------------------------
// IFrame API
// ---------------------------------------------------------------------
function loadIframeApi() {
  if (window.YT && window.YT.Player) { createPlayer(); return }
  const tag = document.createElement('script')
  tag.src = 'https://www.youtube.com/iframe_api'
  document.head.appendChild(tag)
  window.onYouTubeIframeAPIReady = createPlayer
}

function createPlayer() {
  player = new window.YT.Player('yt-player-host', {
    height: '1', width: '1',
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, rel: 0 },
    events: {
      onReady: () => {
        ready = true
        player.setVolume(Math.round((ctx.state.volume || 0.8) * 100))
        if (pendingVideoId) { play(pendingVideoId); pendingVideoId = null }
      },
      onStateChange,
    },
  })
}

function onStateChange(e) {
  const YT = window.YT
  if (!YT) return
  if (e.data === YT.PlayerState.ENDED) ctx.emit('external-ended')
  else if (e.data === YT.PlayerState.PLAYING) ctx.emit('external-play-state', true)
  else if (e.data === YT.PlayerState.PAUSED) ctx.emit('external-play-state', false)
}

// ---------------------------------------------------------------------
// Control de reproduccion
// ---------------------------------------------------------------------
function play(videoId) {
  if (!ready || !player) { pendingVideoId = videoId; return }
  player.loadVideoById(videoId)
  player.playVideo()
}
function pause()  { if (ready && player) player.pauseVideo() }
function resume() { if (ready && player) player.playVideo() }
function stop()   { if (ready && player) player.stopVideo() }
function seek(s)  { if (ready && player) player.seekTo(s, true) }
function getTimes() {
  if (ready && player && player.getDuration)
    return { time: player.getCurrentTime() || 0, duration: player.getDuration() || 0 }
  return { time: 0, duration: 0 }
}
function setVolume(v) { if (ready && player) player.setVolume(Math.round(v * 100)) }
function setMuted(m)  { if (ready && player) (m ? player.mute() : player.unMute()) }

// ---------------------------------------------------------------------
// Autenticacion
// ---------------------------------------------------------------------
async function connect() {
  ctx.toast('Abriendo autorizacion de Google en el navegador...', { platform: 'youtube' })
  const res = await ctx.aero.googleAuthStart()
  if (res.connected) {
    ctx.state.auth.google = { connected: true, userName: res.userName }
    playlistCache = null
    ctx.emit('youtube-auth', ctx.state.auth.google)
    ctx.toast(`Conectado a YouTube como ${res.userName}`, { platform: 'youtube' })
  } else {
    ctx.toast(res.error || 'No se pudo conectar con YouTube.', { platform: 'youtube' })
  }
}

async function logout() {
  await ctx.aero.googleAuthLogout()
  ctx.state.auth.google = { connected: false }
  playlistCache = null
  ctx.emit('youtube-auth', ctx.state.auth.google)
  ctx.toast('Sesion de YouTube cerrada', { platform: 'youtube' })
}

// ---------------------------------------------------------------------
// Carga de contenido real via YouTube Data API v3
// ---------------------------------------------------------------------
async function loadSection(which) {
  if (!ctx.state.auth.google.connected) {
    ctx.toast('Conecta tu cuenta de YouTube para ver tu biblioteca.', { platform: 'youtube' })
    return
  }

  showLoading(sectionLabel(which))

  if (which === 'liked') {
    const res = await ctx.aero.youtubeGetLiked()
    if (!res.ok) { showError(res.error); return }
    renderVideoList(res.items, 'Me gusta')

  } else if (which === 'playlists') {
    const res = await ctx.aero.youtubeGetPlaylists()
    if (!res.ok) { showError(res.error); return }
    playlistCache = res.items
    renderPlaylistList(res.items)

  } else if (which === 'watchlater') {
    // "Ver mas tarde" no es accesible por la API publica de YouTube.
    // Mostramos una busqueda de musica reciente como alternativa.
    const res = await ctx.aero.youtubeSearchMusic('musica 2024 2025')
    if (!res.ok) { showError(res.error); return }
    renderVideoList(res.items, 'Descubrimiento musical')
  }
}

function sectionLabel(w) {
  return w === 'liked' ? 'Me gusta' : w === 'playlists' ? 'Mis playlists' : 'Descubrimiento musical'
}

// ---------------------------------------------------------------------
// Busqueda desde la barra global (llamada desde app.js via evento)
// ---------------------------------------------------------------------
export async function searchYouTube(query) {
  if (!ctx.state.auth.google.connected) return
  showLoading(`Resultados de YouTube: "${query}"`)
  const res = await ctx.aero.youtubeSearchMusic(query)
  if (!res.ok) { showError(res.error); return }
  renderVideoList(res.items, `YouTube: "${query}"`)
}

// ---------------------------------------------------------------------
// Renderizado
// ---------------------------------------------------------------------
function showLoading(title) {
  ctx.els.listViewTitle.textContent = title
  ctx.els.listViewCount.textContent = ''
  ctx.els.listViewBody.innerHTML = '<div class="list-empty">Cargando...</div>'
  ctx.els.listView.hidden = false
  ctx.els.nowPlaying.style.opacity = '0.15'
}

function showError(msg) {
  ctx.els.listViewBody.innerHTML = `<div class="list-empty">Error al cargar el contenido.<br><small style="opacity:.6">${escapeHtml(msg || '')}</small></div>`
}

function renderVideoList(items, title) {
  ctx.els.listViewTitle.textContent = title
  ctx.els.listViewCount.textContent = items.length ? `${items.length} ${items.length === 1 ? 'video' : 'videos'}` : ''

  if (!items.length) {
    ctx.els.listViewBody.innerHTML = '<div class="list-empty">No se encontraron videos.</div>'
    return
  }

  const frag = document.createDocumentFragment()
  items.forEach((item, i) => {
    const row = document.createElement('div')
    row.className = 'track-row'
    const thumb = item.coverUrl ? `background-image:url('${item.coverUrl}')` : ''
    row.innerHTML = `
      <span class="tr-index">${i + 1}</span>
      <span class="tr-cover yt-thumb" style="${thumb}">
        ${!item.coverUrl ? ytIcon(16) : ''}
        <span class="yt-play-overlay">&#9654;</span>
      </span>
      <span class="tr-main">
        <span class="tr-title">${escapeHtml(item.title)}</span>
        <span class="tr-sub">${escapeHtml(item.artist)}</span>
      </span>
      <span class="tr-platform">${ytIcon(14)}</span>
      <span class="tr-dur">${item.durationFormatted || ''}</span>
    `
    const idx = i
    row.addEventListener('click', () => playYt(item, items, idx))
    row.addEventListener('contextmenu', e => {
      e.preventDefault()
      const menu = [
        { label: 'Reproducir ahora', action: () => playYt(item, items, idx) },
        { label: 'Agregar a la cola', action: () => ctx.queue.add({ ...item }) },
      ]
      if (ctx.playlists) menu.push(ctx.playlists.showAddToPlaylistSubmenuItems(item))
      ctx.contextMenu.show(e.clientX, e.clientY, menu)
    })
    frag.appendChild(row)
  })
  ctx.els.listViewBody.innerHTML = ''
  ctx.els.listViewBody.appendChild(frag)
}

function renderPlaylistList(playlists) {
  ctx.els.listViewTitle.textContent = 'Mis playlists'
  ctx.els.listViewCount.textContent = playlists.length ? `${playlists.length} playlists` : ''

  if (!playlists.length) {
    ctx.els.listViewBody.innerHTML = '<div class="list-empty">No tienes playlists en YouTube.</div>'
    return
  }

  const frag = document.createDocumentFragment()
  playlists.forEach(pl => {
    const row = document.createElement('div')
    row.className = 'track-row'
    const thumb = pl.coverUrl ? `background-image:url('${pl.coverUrl}')` : ''
    row.innerHTML = `
      <span class="tr-cover yt-thumb" style="${thumb}">${!pl.coverUrl ? ytIcon(16) : ''}</span>
      <span class="tr-main">
        <span class="tr-title">${escapeHtml(pl.title)}</span>
        <span class="tr-sub">${pl.count} ${pl.count === 1 ? 'video' : 'videos'}</span>
      </span>
      <span class="tr-platform">${ytIcon(14)}</span>
    `
    row.addEventListener('click', () => openPlaylist(pl))
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      showYtPlaylistContextMenu(e, pl)
    })
    frag.appendChild(row)
  })
  ctx.els.listViewBody.innerHTML = ''
  ctx.els.listViewBody.appendChild(frag)
}

async function openPlaylist(pl) {
  showLoading(pl.title)
  const res = await ctx.aero.youtubeGetPlaylistItems(pl.playlistId)
  if (!res.ok) { showError(res.error); return }
  renderVideoList(res.items, pl.title)
}

// Reproduce sin tocar la cola; la lista visible queda como contexto.
function playYt(item, list, index) {
  ctx.player.playItem(item, { list: list || [item], index: index || 0 })
}

// Menu contextual para una PLAYLIST de YouTube en el listado.
function showYtPlaylistContextMenu(e, pl) {
  ctx.contextMenu.show(e.clientX, e.clientY, [
    {
      label: 'Reproducir playlist',
      action: async () => {
        const res = await ctx.aero.youtubeGetAllPlaylistItems(pl.playlistId)
        if (res.ok && res.items.length) {
          ctx.player.playItem(res.items[0], { list: res.items, index: 0 })
        }
      },
    },
    {
      label: 'Agregar playlist a la cola',
      action: async () => {
        const res = await ctx.aero.youtubeGetAllPlaylistItems(pl.playlistId)
        if (res.ok && res.items.length) {
          res.items.forEach((t) => ctx.queue.add(t, { silent: true }))
          ctx.toast(`${res.items.length} canciones agregadas a la cola`, { platform: 'youtube' })
        }
      },
    },
    { sep: true },
    buildImportSubmenu(pl, 'youtube'),
  ])
}

// Construye el item "Importar a Mis playlists  >" con submenu (playlists + "Nueva").
function buildImportSubmenu(externalPlaylist, source) {
  const mine = ctx.playlists?.getAll() || []
  const sub = [
    ...mine.map((p) => ({
      label: p.name,
      thumb: p.coverBase64 || p.coverPath || null,
      action: () =>
        ctx.playlists.importFromExternalPlaylist({
          source,
          externalId: externalPlaylist.playlistId,
          name: externalPlaylist.title,
          coverUrl: externalPlaylist.coverUrl,
          targetPlaylistId: p.id,
        }),
    })),
  ]
  if (mine.length) sub.push({ sep: true })
  sub.push({
    label: 'Crear nueva playlist...',
    action: () =>
      ctx.playlists.importFromExternalPlaylist({
        source,
        externalId: externalPlaylist.playlistId,
        name: externalPlaylist.title,
        coverUrl: externalPlaylist.coverUrl,
        targetPlaylistId: null,
      }),
  })
  return { label: 'Importar a Mis playlists', submenu: sub }
}

export { buildImportSubmenu }
