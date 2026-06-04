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
let isPremium = true // se descarta a false solo si Spotify responde account_error
let readyPromise = null // se resuelve cuando el SDK queda registrado
let readyResolver = null
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

  // Si hay una sesion guardada en el store, restaura el SDK al arranque
  // (sin esto, deviceId queda null y play() fallaba con el aviso falso).
  restoreSessionIfAny()
}

async function restoreSessionIfAny() {
  try {
    const status = await ctx.aero.getAuthStatus()
    if (status?.spotify?.connected) {
      const token = await ctx.aero.spotifyGetToken()
      if (token) {
        accessToken = token
        initWebPlaybackSdk()
      }
    }
  } catch {
    /* sin sesion previa */
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
    isPremium = true
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
  // Promesa que play() puede await-ear hasta tener deviceId.
  readyPromise = new Promise((resolve) => {
    readyResolver = resolve
  })

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
    if (readyResolver) {
      readyResolver(true)
      readyResolver = null
    }
  })
  sdkPlayer.addListener('not_ready', () => {
    deviceId = null
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
  sdkPlayer.addListener('initialization_error', ({ message }) => {
    ctx.toast('Spotify: ' + message, { platform: 'spotify' })
    if (readyResolver) { readyResolver(false); readyResolver = null }
  })
  sdkPlayer.addListener('authentication_error', () => {
    ctx.toast('Spotify: error de autenticacion. Vuelve a conectar.', { platform: 'spotify' })
    if (readyResolver) { readyResolver(false); readyResolver = null }
  })
  sdkPlayer.addListener('account_error', () => {
    isPremium = false
    ctx.toast('Spotify: la reproduccion requiere una cuenta Premium.', { platform: 'spotify' })
    if (readyResolver) { readyResolver(false); readyResolver = null }
  })
  sdkPlayer.connect()
}

// ---------------------------------------------------------------------
// Control de reproduccion (via Web API sobre el dispositivo del SDK)
// ---------------------------------------------------------------------
async function play(uri) {
  // Si no hay sesion, no podemos hacer nada.
  if (!ctx.state.auth.spotify.connected) {
    ctx.toast('Conecta tu cuenta de Spotify para reproducir.', { platform: 'spotify' })
    return
  }
  // Si la cuenta ya respondio que no es Premium, no insistas.
  if (!isPremium) {
    ctx.toast('La reproduccion de Spotify requiere cuenta Premium.', { platform: 'spotify' })
    return
  }
  // Si el SDK aun no esta inicializado (puede pasar al primer arranque),
  // dispara la inicializacion ahora mismo.
  if (!sdkPlayer) {
    accessToken = (await ctx.aero.spotifyGetToken()) || accessToken
    if (accessToken) initWebPlaybackSdk()
  }
  // Espera hasta 10 segundos a que el SDK registre su deviceId.
  if (!deviceId) {
    const ready = await Promise.race([
      readyPromise || Promise.resolve(false),
      new Promise((r) => setTimeout(() => r(false), 10000)),
    ])
    if (!ready || !deviceId) {
      ctx.toast('El reproductor de Spotify no respondio. Intenta de nuevo en unos segundos.', { platform: 'spotify' })
      return
    }
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
      const menu = [
        { label: 'Reproducir ahora', action: () => playSp(item, items, i) },
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

// Menu contextual para playlist/album de Spotify en el listado.
function showSpCollectionContextMenu(e, it) {
  const isPlaylist = !!it.playlistId
  const externalId = it.playlistId || it.albumId
  ctx.contextMenu.show(e.clientX, e.clientY, [
    {
      label: isPlaylist ? 'Reproducir playlist' : 'Reproducir album',
      action: async () => {
        const res = isPlaylist
          ? await ctx.aero.spotifyGetAllPlaylistTracks(externalId)
          : await ctx.aero.spotifyGetAlbumTracks(externalId)
        if (res.ok && res.items.length) {
          ctx.player.playItem(res.items[0], { list: res.items, index: 0 })
        }
      },
    },
    {
      label: 'Agregar a la cola',
      action: async () => {
        const res = isPlaylist
          ? await ctx.aero.spotifyGetAllPlaylistTracks(externalId)
          : await ctx.aero.spotifyGetAlbumTracks(externalId)
        if (res.ok && res.items.length) {
          res.items.forEach((t) => ctx.queue.add(t, { silent: true }))
          ctx.toast(`${res.items.length} canciones agregadas a la cola`, { platform: 'spotify' })
        }
      },
    },
    { sep: true },
    buildSpImportSubmenu({ externalId, title: it.title, coverUrl: it.coverUrl }, isPlaylist ? 'spotify' : 'spotify-album'),
  ])
}

function buildSpImportSubmenu(pl, sourceTag) {
  const mine = ctx.playlists?.getAll() || []
  const fetcher = async () => {
    if (sourceTag === 'spotify') return await ctx.aero.spotifyGetAllPlaylistTracks(pl.externalId)
    return await ctx.aero.spotifyGetAlbumTracks(pl.externalId)
  }
  const importTo = async (targetId) => {
    const progress = ctx.toast(`Importando "${pl.title}"...`, { duration: 60000, progress: true, platform: 'spotify' })
    const res = await fetcher()
    if (progress && progress.remove) progress.remove()
    if (!res.ok || !res.items.length) {
      ctx.toast(`No se pudieron importar canciones de "${pl.title}".`, { platform: 'spotify' })
      return
    }
    if (targetId) {
      const r = await ctx.aero.playlistsAddBulk(targetId, res.items)
      await ctx.playlists.load()
      const target = ctx.playlists.findById(targetId)
      ctx.toast(`Importadas ${r.added} en "${target?.name || ''}"`, { platform: 'spotify' })
    } else {
      ctx.playlists.showCreateModal({
        prefillName: pl.title,
        prefillCover: pl.coverUrl || null,
        onCreated: async (newPl) => {
          const r = await ctx.aero.playlistsAddBulk(newPl.id, res.items)
          await ctx.playlists.load()
          ctx.toast(`Importadas ${r.added} canciones`, { platform: 'spotify' })
        },
      })
    }
  }
  const sub = mine.map((p) => ({
    label: p.name,
    thumb: p.coverBase64 || p.coverPath || null,
    action: () => importTo(p.id),
  }))
  if (mine.length) sub.push({ sep: true })
  sub.push({ label: 'Crear nueva playlist...', action: () => importTo(null) })
  return { label: 'Importar a Mis playlists', submenu: sub }
}

// Busqueda en Spotify usada por la barra de busqueda global.
export async function searchSpotify(query) {
  const res = await ctx.aero.spotifySearchTracks(query)
  return res
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
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      showSpCollectionContextMenu(e, it)
    })
    frag.appendChild(row)
  })
  ctx.els.listViewBody.innerHTML = ''
  ctx.els.listViewBody.appendChild(frag)
}
