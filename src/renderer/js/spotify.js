/* =====================================================================
   AERO PLAYER  ·  spotify.js
   Conexion con Spotify (OAuth2 PKCE) y reproduccion mediante el Spotify
   Web Playback SDK. La reproduccion completa requiere una cuenta Premium y
   las credenciales configuradas en el archivo .env.
   ===================================================================== */

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
    getOAuthToken: (cb) => cb(accessToken),
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
  if (!accessToken || !deviceId) {
    ctx.toast('Conecta Spotify Premium para reproducir.', { platform: 'spotify' })
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
    await fetch('https://api.spotify.com/v1' + path, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    ctx.toast('No se pudo controlar la reproduccion de Spotify.', { platform: 'spotify' })
  }
}

function loadSection(which) {
  if (!ctx.state.auth.spotify.connected) {
    ctx.toast('Conecta tu cuenta de Spotify para ver tu biblioteca.', { platform: 'spotify' })
    return
  }
  const labels = {
    saved: 'Canciones guardadas',
    playlists: 'Mis playlists',
    albums: 'Albumes guardados',
  }
  ctx.toast(`Spotify · ${labels[which] || which}`, { platform: 'spotify' })
}
