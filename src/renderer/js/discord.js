/* =====================================================================
   AERO PLAYER  ·  discord.js
   Discord Rich Presence. Estructura mostrada:
     [Large: aero/konata]
       Aero Player              (viene de Discord Developer Portal)
       <titulo>                 (details)
       <artista>                (state)
       ⏳ X:XX restantes        (timestamp end - now)
       [Small: local/disco]     (small image, sync con play/pause via texto)

   Limitaciones de Discord (sin escapatoria):
   - Solo 2 imagenes por presencia (large + small).
   - La barra de progreso bonita "0:23 ── 3:45" es exclusiva de apps
     verificadas tipo Spotify. Los demas vemos hourglass + tiempo restante.
   - El header dice "Jugando" siempre para apps no verificadas (el de
     "Escuchando" morado tambien es exclusivo de Spotify).
   ===================================================================== */

const CLIENT_ID = '1512156625136259144' // Aero Player en Discord Developer Portal
const RECONNECT_MS = 30_000
const RESYNC_MS = 10_000 // re-sincroniza el tiempo cada 10s mientras suena

let ctx = null
let connected = false
let reconnectTimer = null
let resyncTimer = null

export async function initDiscord(context) {
  ctx = context
  if (!ctx.aero || !ctx.aero.discordInit) return // stub bridge (fuera de Tauri)

  await tryConnect()

  ctx.on('track-changed', () => sendCurrent())
  ctx.on('play-state', () => sendCurrent())

  // Re-sincroniza periodicamente para que el tiempo en Discord no se
  // desfase con seeks/buffering. Discord interpola entre updates.
  startResyncLoop()

  window.addEventListener('beforeunload', () => {
    if (ctx.aero.discordDisconnect) ctx.aero.discordDisconnect().catch(() => {})
  })
}

async function tryConnect() {
  const res = await ctx.aero.discordInit(CLIENT_ID)
  connected = !!res.ok
  if (!connected) scheduleReconnect()
  else sendCurrent()
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    await tryConnect()
  }, RECONNECT_MS)
}

function startResyncLoop() {
  if (resyncTimer) clearInterval(resyncTimer)
  resyncTimer = setInterval(() => {
    if (connected && ctx.state.currentTrack && ctx.state.isPlaying) {
      sendCurrent()
    }
  }, RESYNC_MS)
}

async function sendCurrent() {
  if (!ctx) return
  const track = ctx.state.currentTrack
  if (!track) {
    if (connected) ctx.aero.discordClear().catch(() => {})
    return
  }

  // Lee tiempo y duracion reales del reproductor activo (local/yt/sp).
  let elapsed = 0
  let duration = track.duration || 0
  try {
    if (ctx.player && ctx.player.getPlaybackTimes) {
      const t = ctx.player.getPlaybackTimes()
      if (t && typeof t.time === 'number') elapsed = Math.max(0, Math.floor(t.time))
      if (t && typeof t.duration === 'number' && t.duration > 0) duration = Math.floor(t.duration)
    }
  } catch {}

  const payload = {
    title: track.title || 'Sin titulo',
    artist: track.artist || 'Artista desconocido',
    source: track.source || 'aero',
    isPlaying: !!ctx.state.isPlaying,
    duration: duration > 0 ? duration : null,
    elapsed,
    spotifyId: track.spotifyId || null,
    videoId: track.videoId || null,
  }

  const res = await ctx.aero.discordUpdate(payload)
  if (!res.ok) {
    connected = false
    scheduleReconnect()
  }
}
