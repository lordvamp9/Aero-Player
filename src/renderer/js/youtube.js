/* =====================================================================
   AERO PLAYER  ·  youtube.js
   Reproduccion mediante la YouTube IFrame Player API (oficial y gratuita)
   y conexion de la cuenta de Google para acceder a las playlists.
   La reproduccion por videoId funciona sin claves; el acceso a playlists
   personales requiere completar las credenciales en el archivo .env.
   ===================================================================== */

let ctx
let player = null
let ready = false
let pendingVideoId = null

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
  }

  loadIframeApi()
}

// ---------------------------------------------------------------------
// Carga de la API y creacion del reproductor oculto
// ---------------------------------------------------------------------
function loadIframeApi() {
  if (window.YT && window.YT.Player) {
    createPlayer()
    return
  }
  const tag = document.createElement('script')
  tag.src = 'https://www.youtube.com/iframe_api'
  document.head.appendChild(tag)
  window.onYouTubeIframeAPIReady = createPlayer
}

function createPlayer() {
  player = new window.YT.Player('yt-player-host', {
    height: '1',
    width: '1',
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, rel: 0 },
    events: {
      onReady: () => {
        ready = true
        player.setVolume(Math.round((ctx.state.volume || 0.8) * 100))
        if (pendingVideoId) {
          play(pendingVideoId)
          pendingVideoId = null
        }
      },
      onStateChange: onStateChange,
    },
  })
}

function onStateChange(e) {
  const YT = window.YT
  if (!YT) return
  if (e.data === YT.PlayerState.ENDED) {
    ctx.emit('external-ended')
  } else if (e.data === YT.PlayerState.PLAYING) {
    ctx.emit('external-play-state', true)
  } else if (e.data === YT.PlayerState.PAUSED) {
    ctx.emit('external-play-state', false)
  }
}

// ---------------------------------------------------------------------
// Control de reproduccion
// ---------------------------------------------------------------------
function play(videoId) {
  if (!ready || !player) {
    pendingVideoId = videoId
    return
  }
  player.loadVideoById(videoId)
  player.playVideo()
}
function pause() {
  if (ready && player) player.pauseVideo()
}
function resume() {
  if (ready && player) player.playVideo()
}
function stop() {
  if (ready && player) player.stopVideo()
}
function seek(seconds) {
  if (ready && player) player.seekTo(seconds, true)
}
function getTimes() {
  if (ready && player && player.getDuration) {
    return { time: player.getCurrentTime() || 0, duration: player.getDuration() || 0 }
  }
  return { time: 0, duration: 0 }
}
function setVolume(v) {
  if (ready && player) player.setVolume(Math.round(v * 100))
}
function setMuted(m) {
  if (ready && player) (m ? player.mute() : player.unMute())
}

// ---------------------------------------------------------------------
// Autenticacion
// ---------------------------------------------------------------------
async function connect() {
  ctx.toast('Abriendo autorizacion de Google en el navegador...', { platform: 'youtube' })
  const res = await ctx.aero.googleAuthStart()
  if (res.connected) {
    ctx.state.auth.google = { connected: true, userName: res.userName }
    ctx.emit('youtube-auth', ctx.state.auth.google)
    ctx.toast(`Conectado a YouTube como ${res.userName}`, { platform: 'youtube' })
  } else {
    ctx.toast(res.error || 'No se pudo conectar con YouTube.', { platform: 'youtube' })
  }
}

async function logout() {
  await ctx.aero.googleAuthLogout()
  ctx.state.auth.google = { connected: false }
  ctx.emit('youtube-auth', ctx.state.auth.google)
  ctx.toast('Sesion de YouTube cerrada', { platform: 'youtube' })
}

function loadSection(which) {
  if (!ctx.state.auth.google.connected) {
    ctx.toast('Conecta tu cuenta de YouTube para ver tus playlists.', { platform: 'youtube' })
    return
  }
  // Con las credenciales configuradas en .env, aqui se consultaria la
  // YouTube Data API para listar el contenido de cada seccion.
  const labels = {
    liked: 'Me gusta',
    watchlater: 'Ver mas tarde',
    playlists: 'Mis playlists',
  }
  ctx.toast(`YouTube · ${labels[which] || which}`, { platform: 'youtube' })
}
