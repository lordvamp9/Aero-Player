/* =====================================================================
   AERO PLAYER  ·  spotify.js
   Conexion con Spotify (OAuth2 PKCE) y reproduccion mediante el Spotify
   Web Playback SDK. La reproduccion completa requiere una cuenta Premium y
   las credenciales configuradas en el archivo .env.
   ===================================================================== */

import { escapeHtml, spIcon } from './app.js'

let ctx
let sdkPlayer = null
let deviceId = null
let accessToken = null
let lastState = { position: 0, duration: 0, paused: true, ts: Date.now() }

export function initSpotify(context) {
  ctx = context

  ctx.spotify = {
    connect,
    logout,
    loadSection,
    play,
    pause,
    resume,
    seek,
    getTimes,
    setVolume,
    setMuted,
    isPlaying: () => (lastState ? !lastState.paused : null),
  }
}

// ---------------------------------------------------------------------
// Autenticacion
// ---------------------------------------------------------------------
async function connect() {
  ctx.toast('Abriendo autorizacion de Spotify en el navegador...', { platform: 'spotify' })
  const res = await ctx.aero.spotifyAuthStart()
  if (res.connected) {
    accessToken = res.accessToken || null
    ctx.state.auth.spotify = { connected: true, userName: res.userName }
    ctx.emit('spotify-auth', ctx.state.auth.spotify)
    ctx.toast(`Conectado a Spotify como ${res.userName}`, { platform: 'spotify' })
    if (accessToken) initWebPlaybackSdk()
  } else {
    ctx.toast(res.error || 'No se pudo conectar con Spotify.', { platform: 'spotify' })
  }
}

async function logout() {
  await ctx.aero.spotifyAuthLogout()
  accessToken = null
  if (sdkPlayer) {
    try {
      sdkPlayer.disconnect()
    } catch {
      /* ignore */
    }
    sdkPlayer = null
  }
  ctx.state.auth.spotify = { connected: false }
  ctx.emit('spotify-auth', ctx.state.auth.spotify)
  ctx.toast('Sesion de Spotify cerrada', { platform: 'spotify' })
}

// ---------------------------------------------------------------------
// Web Playback SDK
// ---------------------------------------------------------------------
function initWebPlaybackSdk() {
  if (sdkPlayer) return
  const boot = () => createSdkPlayer()
  if (window.Spotify && window.Spotify.Player) {
    boot()
    return
  }
  window.onSpotifyWebPlaybackSDKReady = boot
  if (!document.getElementById('spotify-sdk-script')) {
    const tag = document.createElement('script')
    tag.id = 'spotify-sdk-script'
    tag.src = 'https://sdk.scdn.co/spotify-player.js'
    document.head.appendChild(tag)
  }
}

function createSdkPlayer() {
  sdkPlayer = new window.Spotify.Player({
    name: 'Aero Player',
    // Pide siempre un token vigente al proceso principal (se refresca solo).
    getOAuthToken: (cb) => {
      ctx.aero.spotifyGetToken().then((t) => cb(t || accessToken)).catch(() => cb(accessToken))
    },
    volume: ctx.state.volume || 0.8,
  })

  sdkPlayer.addListener('ready', ({ device_id }) => {
    deviceId = device_id
  })
  sdkPlayer.addListener('player_state_changed', (s) => {
    if (!s) return
    lastState = {
      position: s.position,
      duration: s.duration,
      paused: s.paused,
      ts: Date.now(),
    }
    ctx.emit('external-play-state', !s.paused)
    // Fin de pista: posicion 0 y pausado tras haber sonado.
    if (s.paused && s.position === 0 && s.track_window?.previous_tracks?.length) {
      ctx.emit('external-ended')
    }
  })
  sdkPlayer.addListener('initialization_error', ({ message }) => ctx.toast('Spotify: ' + message, { platform: 'spotify' }))
  sdkPlayer.addListener('authentication_error', () => ctx.toast('Spotify: error de autenticacion.', { platform: 'spotify' }))
  sdkPlayer.addListener('account_error', () =>
    ctx.toast('Spotify: la reproduccion requiere una cuenta Premium.', { platform: 'spotify' })
  )
  sdkPlayer.connect()
}

// ---------------------------------------------------------------------
// Control de reproduccion (via Web API sobre el dispositivo del SDK)
// ---------------------------------------------------------------------
async function play(uri) {
  if (!deviceId) {
    ctx.toast('El reproductor de Spotify aun no esta listo. Requiere cuenta Premium.', { platform: 'spotify' })
    return
  }
  await apiPut(`/me/player/play?device_id=${deviceId}`, { uris: [uri] })
}
function pause() {
  if (sdkPlayer) sdkPlayer.pause()
}
function resume() {
  if (sdkPlayer) sdkPlayer.resume()
}
function seek(seconds) {
  if (sdkPlayer) sdkPlayer.seek(Math.round(seconds * 1000))
}
function getTimes() {
  let position = lastState.position
  if (!lastState.paused) position += Date.now() - lastState.ts
  return { time: position / 1000, duration: lastState.duration / 1000 }
}
function setVolume(v) {
  if (sdkPlayer) sdkPlayer.setVolume(v)
}
function setMuted(m) {
  if (sdkPlayer) sdkPlayer.setVolume(m ? 0 : ctx.state.volume || 0.8)
}

async function apiPut(path, body) {
  try {
    const token = (await ctx.aero.spotifyGetToken()) || accessToken
    await fetch('https://api.spotify.com/v1' + path, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    ctx.toast('No se pudo controlar la reproduccion de Spotify.', { platform: 'spotify' })
  }
}

// ---------------------------------------------------------------------
// Carga de contenido real via Spotify Web API
// ---------------------------------------------------------------------
async function loadSection(which) {
  if (!ctx.state.auth.spotify.connected) {
    ctx.toast('Conecta tu cuenta de Spotify para ver tu biblioteca.', { platform: 'spotify' })
    return
  }

  if (which === 'saved') {
    showLoading('Canciones guardadas')
    const res = await ctx.aero.spotifyGetSavedTracks()
    if (!res.ok) return showError(res.error)
    renderTrackList(res.items, 'Canciones guardadas')
  } else if (which === 'playlists') {
    showLoading('Mis playlists')
    const res = await ctx.aero.spotifyGetPlaylists()
    if (!res.ok) return showError(res.error)
    renderCollectionList(res.items, 'Mis playlists', openPlaylist)
  } else if (which === 'albums') {
    showLoading('Albumes guardados')
    const res = await ctx.aero.spotifyGetSavedAlbums()
    if (!res.ok) return showError(res.error)
    renderCollectionList(res.items, 'Albumes guardados', openAlbum)
  }
}

async function openPlaylist(pl) {
  showLoading(pl.title)
  const res = await ctx.aero.spotifyGetPlaylistTracks(pl.playlistId)
  if (!res.ok) return showError(res.error)
  renderTrackList(res.items, pl.title)
}

async function openAlbum(al) {
  showLoading(al.title)
  const res = await ctx.aero.spotifyGetAlbumTracks(al.albumId)
  if (!res.ok) return showError(res.error)
  renderTrackList(res.items, al.title)
}

function playSp(item, list, index) {
  ctx.player.playItem(item, { list: list || [item], index: index || 0 })
}

// ---------------------------------------------------------------------
// Renderizado en la vista de listas
// ---------------------------------------------------------------------
function showLoading(title) {
  ctx.els.listViewTitle.textContent = title
  ctx.els.listViewCount.textContent = ''
  ctx.els.listViewBody.innerHTML = '<div class="list-empty">Cargando...</div>'
  ctx.els.listView.hidden = false
  ctx.els.nowPlaying.style.opacity = '0.15'
}

function showError(msg) {
  ctx.els.listViewBody.innerHTML = `<div class="list-empty">No se pudo cargar el contenido de Spotify.<br><small style="opacity:.6">${escapeHtml(
    msg || ''
  )}</small></div>`
}

function renderTrackList(items, title) {
  ctx.els.listViewTitle.textContent = title
  ctx.els.listViewCount.textContent = items.length
    ? `${items.length} ${items.length === 1 ? 'cancion' : 'canciones'}`
    : ''
  if (!items.length) {
    ctx.els.listViewBody.innerHTML = '<div class="list-empty">No hay canciones en esta seccion.</div>'
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
      <span class="tr-cover" style="${cover}">${item.coverUrl ? '' : spIcon(16)}</span>
      <span class="tr-main">
        <span class="tr-title">${escapeHtml(item.title)}</span>
        <span class="tr-sub">${escapeHtml(item.artist)}</span>
      </span>
      <span class="tr-album">${escapeHtml(item.album || '')}</span>
      <span class="tr-platform">${spIcon(14)}</span>
      <span class="tr-dur">${item.durationFormatted || ''}</span>
    `
    row.addEventListener('click', () => playSp(item, items, i))
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      ctx.contextMenu.show(e.clientX, e.clientY, [
        { label: 'Reproducir ahora', action: () => playSp(item, items, i) },
        { label: 'Agregar a la cola', action: () => ctx.queue.add({ ...item }) },
      ])
    })
    frag.appendChild(row)
  })
  ctx.els.listViewBody.innerHTML = ''
  ctx.els.listViewBody.appendChild(frag)
}

function renderCollectionList(items, title, onOpen) {
  ctx.els.listViewTitle.textContent = title
  ctx.els.listViewCount.textContent = items.length ? `${items.length}` : ''
  if (!items.length) {
    ctx.els.listViewBody.innerHTML = '<div class="list-empty">No hay elementos en esta seccion.</div>'
    return
  }
  const frag = document.createDocumentFragment()
  items.forEach((it) => {
    const row = document.createElement('div')
    row.className = 'track-row'
    const cover = it.coverUrl ? `background-image:url('${it.coverUrl}')` : ''
    row.innerHTML = `
      <span class="tr-cover" style="${cover}">${it.coverUrl ? '' : spIcon(16)}</span>
      <span class="tr-main">
        <span class="tr-title">${escapeHtml(it.title)}</span>
        <span class="tr-sub">${escapeHtml(it.owner || '')}${it.count ? ' · ' + it.count + ' pistas' : ''}</span>
      </span>
      <span class="tr-platform">${spIcon(14)}</span>
    `
    row.addEventListener('click', () => onOpen(it))
    frag.appendChild(row)
  })
  ctx.els.listViewBody.innerHTML = ''
  ctx.els.listViewBody.appendChild(frag)
}
