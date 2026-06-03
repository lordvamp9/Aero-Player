/* =====================================================================
   AERO PLAYER  ·  player.js
   Reproductor unificado. Decide el motor segun item.source:
     local   -> elemento <audio> nativo + AnalyserNode (FFT real)
     youtube -> YouTube IFrame Player API
     spotify -> Spotify Web Playback SDK
   Tambien gobierna transporte, progreso, volumen y la UI "ahora suena".
   ===================================================================== */

import { formatTime, platformIcon } from './app.js'

let ctx
let audio

// Grafo de Web Audio (se crea una sola vez sobre el elemento <audio>).
let audioCtx = null
let analyser = null
let sourceNode = null

let progressRAF = null
let scrubbing = false

export function initPlayer(context) {
  ctx = context
  audio = ctx.els.audio
  audio.volume = ctx.state.volume

  wireTransport()
  wireProgress()
  wireVolume()
  wireAudioEvents()
  applyVolumeUI()

  // API publica para el resto de modulos.
  ctx.player = {
    playItem,
    playId,
    togglePlay,
    pause,
    next,
    prev,
    seekToFraction,
    setVolume,
    getFrequencyData,
    getTimeDomainData,
    getCurrent,
    isLocalActive: () => getCurrent()?.source === 'local' && ctx.state.isPlaying,
  }
}

// ---------------------------------------------------------------------
// Grafo de audio para el visualizador
// ---------------------------------------------------------------------
function ensureAudioGraph() {
  if (audioCtx) return
  const AC = window.AudioContext || window.webkitAudioContext
  audioCtx = new AC()
  analyser = audioCtx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.82
  sourceNode = audioCtx.createMediaElementSource(audio)
  sourceNode.connect(analyser)
  analyser.connect(audioCtx.destination)
  window._aeroAnalyser = analyser
}

function getFrequencyData() {
  if (!analyser || !ctx.player.isLocalActive()) return null
  const arr = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(arr)
  return arr
}

function getTimeDomainData() {
  if (!analyser || !ctx.player.isLocalActive()) return null
  const arr = new Uint8Array(analyser.fftSize)
  analyser.getByteTimeDomainData(arr)
  return arr
}

// ---------------------------------------------------------------------
// Reproduccion
// ---------------------------------------------------------------------
function getCurrent() {
  return ctx.state.queue.find((i) => i.id === ctx.state.currentId) || null
}

function playId(id) {
  const item = ctx.state.queue.find((i) => i.id === id)
  if (item) playItem(item)
}

async function playItem(item) {
  if (!item) return
  ctx.state.currentId = item.id

  // Detiene cualquier motor externo antes de cambiar de fuente.
  stopExternalEngines(item.source)

  if (item.source === 'local') await loadLocal(item)
  else if (item.source === 'youtube') loadYouTube(item)
  else if (item.source === 'spotify') loadSpotify(item)

  updateNowPlaying(item)
  ctx.emit('track-changed', item)
}

async function loadLocal(item) {
  ensureAudioGraph()
  if (audioCtx.state === 'suspended') await audioCtx.resume()
  const url = ctx.aero.toMediaUrl(item.filePath)
  if (audio.src !== url) audio.src = url
  try {
    await audio.play()
    setPlaying(true)
  } catch (err) {
    ctx.toast('No se pudo reproducir el archivo local.')
    setPlaying(false)
  }
}

function loadYouTube(item) {
  audio.pause()
  if (ctx.youtube && ctx.youtube.play) {
    ctx.youtube.play(item.videoId)
    setPlaying(true)
  } else {
    ctx.toast('Conecta YouTube para reproducir este contenido.', { platform: 'youtube' })
  }
}

function loadSpotify(item) {
  audio.pause()
  if (ctx.spotify && ctx.spotify.play) {
    ctx.spotify.play(item.spotifyUri)
    setPlaying(true)
  } else {
    ctx.toast('Conecta Spotify para reproducir este contenido.', { platform: 'spotify' })
  }
}

function stopExternalEngines(exceptSource) {
  if (exceptSource !== 'youtube' && ctx.youtube && ctx.youtube.stop) ctx.youtube.stop()
  if (exceptSource !== 'spotify' && ctx.spotify && ctx.spotify.pause) ctx.spotify.pause()
}

function togglePlay() {
  const cur = getCurrent()
  if (!cur) {
    // Si no hay pista activa, arranca la primera de la cola.
    if (ctx.state.queue.length) playItem(ctx.state.queue[0])
    return
  }
  if (ctx.state.isPlaying) pause()
  else resume()
}

function resume() {
  const cur = getCurrent()
  if (!cur) return
  if (cur.source === 'local') {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume()
    audio.play()
    setPlaying(true)
  } else if (cur.source === 'youtube' && ctx.youtube?.resume) {
    ctx.youtube.resume()
    setPlaying(true)
  } else if (cur.source === 'spotify' && ctx.spotify?.resume) {
    ctx.spotify.resume()
    setPlaying(true)
  }
}

function pause() {
  const cur = getCurrent()
  if (cur?.source === 'local') audio.pause()
  else if (cur?.source === 'youtube' && ctx.youtube?.pause) ctx.youtube.pause()
  else if (cur?.source === 'spotify' && ctx.spotify?.pause) ctx.spotify.pause()
  setPlaying(false)
}

function next(auto = false) {
  const q = ctx.state.queue
  if (!q.length) return
  const idx = q.findIndex((i) => i.id === ctx.state.currentId)

  if (ctx.state.repeat === 'one' && auto) {
    playItem(q[idx] || q[0])
    return
  }
  let nextIdx
  if (ctx.state.shuffle) {
    nextIdx = randomIndexExcept(q.length, idx)
  } else {
    nextIdx = idx + 1
    if (nextIdx >= q.length) {
      if (ctx.state.repeat === 'all') nextIdx = 0
      else {
        setPlaying(false)
        return
      }
    }
  }
  playItem(q[nextIdx])
}

function prev() {
  const q = ctx.state.queue
  if (!q.length) return
  // Si han pasado mas de 3s, reinicia la pista actual.
  if (getCurrent()?.source === 'local' && audio.currentTime > 3) {
    audio.currentTime = 0
    return
  }
  const idx = q.findIndex((i) => i.id === ctx.state.currentId)
  let prevIdx = idx - 1
  if (prevIdx < 0) prevIdx = ctx.state.repeat === 'all' ? q.length - 1 : 0
  playItem(q[prevIdx])
}

function randomIndexExcept(len, except) {
  if (len <= 1) return 0
  let r
  do {
    r = Math.floor(Math.random() * len)
  } while (r === except)
  return r
}

// ---------------------------------------------------------------------
// Estado de reproduccion + UI
// ---------------------------------------------------------------------
function setPlaying(playing) {
  ctx.state.isPlaying = playing
  ctx.els.iconPlay.hidden = playing
  ctx.els.iconPause.hidden = !playing
  ctx.els.btnPlay.classList.toggle('playing', playing)
  ctx.els.btnPlay.title = playing ? 'Pausar' : 'Reproducir'
  ctx.emit('play-state', playing)

  if (playing) startProgressLoop()
  else stopProgressLoop()
}

function updateNowPlaying(item) {
  const cover = item.coverUrl ? `url("${item.coverUrl}")` : ''
  // Portada central al reproducir: caratula si existe, o un icono tenue.
  if (item.coverUrl) {
    ctx.els.npCover.style.backgroundImage = cover
    ctx.els.npCover.innerHTML = ''
  } else {
    ctx.els.npCover.style.backgroundImage = ''
    ctx.els.npCover.innerHTML = `<span class="np-cover-fallback">${platformIcon(item.source, 46)}</span>`
  }
  ctx.els.npCover.hidden = false
  // Reinicia la animacion de entrada.
  ctx.els.npCover.style.animation = 'none'
  void ctx.els.npCover.offsetWidth
  ctx.els.npCover.style.animation = ''

  ctx.els.npMiniCover.style.backgroundImage = cover
  ctx.els.npTitle.textContent = item.title
  ctx.els.npArtist.textContent = item.artist
  ctx.els.npMiniTitle.textContent = item.title
  ctx.els.npMiniArtist.textContent = item.artist

  ctx.els.statusCenter.textContent = `${item.artist} — ${item.title}`
  ctx.els.statusRight.textContent = statusRightText(item)
}

function statusRightText(item) {
  if (item.source === 'youtube') return 'YouTube'
  if (item.source === 'spotify') return 'Spotify'
  const parts = []
  if (item.codec) parts.push(String(item.codec).toUpperCase())
  if (item.bitrate) parts.push(item.bitrate + ' kbps')
  return parts.join(' · ') || 'Archivo local'
}

// ---------------------------------------------------------------------
// Barra de progreso
// ---------------------------------------------------------------------
function startProgressLoop() {
  stopProgressLoop()
  const tick = () => {
    if (!scrubbing) updateProgressUI()
    progressRAF = requestAnimationFrame(tick)
  }
  progressRAF = requestAnimationFrame(tick)
}
function stopProgressLoop() {
  if (progressRAF) cancelAnimationFrame(progressRAF)
  progressRAF = null
}

function getPlaybackTimes() {
  const cur = getCurrent()
  if (cur?.source === 'local') {
    return { time: audio.currentTime, duration: audio.duration || cur.duration || 0 }
  }
  if (cur?.source === 'youtube' && ctx.youtube?.getTimes) return ctx.youtube.getTimes()
  if (cur?.source === 'spotify' && ctx.spotify?.getTimes) return ctx.spotify.getTimes()
  return { time: 0, duration: cur?.duration || 0 }
}

function updateProgressUI() {
  const { time, duration } = getPlaybackTimes()
  const frac = duration > 0 ? Math.min(1, time / duration) : 0
  ctx.els.progressFill.style.width = frac * 100 + '%'
  ctx.els.progressKnob.style.left = frac * 100 + '%'
  ctx.els.timeCurrent.textContent = formatTime(time)
  ctx.els.timeTotal.textContent = formatTime(duration)
}

function wireProgress() {
  const rail = ctx.els.progressRail
  const fracFromEvent = (e) => {
    const r = rail.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }
  rail.addEventListener('mousedown', (e) => {
    scrubbing = true
    rail.classList.add('scrubbing')
    previewSeek(fracFromEvent(e))
    const move = (ev) => previewSeek(fracFromEvent(ev))
    const up = (ev) => {
      seekToFraction(fracFromEvent(ev))
      scrubbing = false
      rail.classList.remove('scrubbing')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  })
}

function previewSeek(frac) {
  ctx.els.progressFill.style.width = frac * 100 + '%'
  ctx.els.progressKnob.style.left = frac * 100 + '%'
  const { duration } = getPlaybackTimes()
  ctx.els.timeCurrent.textContent = formatTime(frac * duration)
}

function seekToFraction(frac) {
  const cur = getCurrent()
  const { duration } = getPlaybackTimes()
  const target = frac * duration
  if (cur?.source === 'local') audio.currentTime = target
  else if (cur?.source === 'youtube' && ctx.youtube?.seek) ctx.youtube.seek(target)
  else if (cur?.source === 'spotify' && ctx.spotify?.seek) ctx.spotify.seek(target)
}

// ---------------------------------------------------------------------
// Volumen
// ---------------------------------------------------------------------
function wireVolume() {
  const rail = ctx.els.volumeRail
  const fracFromEvent = (e) => {
    const r = rail.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }
  rail.addEventListener('mousedown', (e) => {
    setVolume(fracFromEvent(e))
    const move = (ev) => setVolume(fracFromEvent(ev))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      ctx.persist.config()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  })
  ctx.els.btnMute.addEventListener('click', () => {
    ctx.state.muted = !ctx.state.muted
    audio.muted = ctx.state.muted
    if (ctx.youtube?.setMuted) ctx.youtube.setMuted(ctx.state.muted)
    if (ctx.spotify?.setMuted) ctx.spotify.setMuted(ctx.state.muted)
    applyVolumeUI()
  })
}

function setVolume(v) {
  ctx.state.volume = v
  ctx.state.muted = false
  audio.muted = false
  audio.volume = v
  if (ctx.youtube?.setVolume) ctx.youtube.setVolume(v)
  if (ctx.spotify?.setVolume) ctx.spotify.setVolume(v)
  applyVolumeUI()
}

function applyVolumeUI() {
  const v = ctx.state.muted ? 0 : ctx.state.volume
  ctx.els.volumeFill.style.width = v * 100 + '%'
  ctx.els.volumeKnob.style.left = v * 100 + '%'
}

// ---------------------------------------------------------------------
// Transporte (botones)
// ---------------------------------------------------------------------
function wireTransport() {
  ctx.els.btnPlay.addEventListener('click', togglePlay)
  ctx.els.btnNext.addEventListener('click', () => next(false))
  ctx.els.btnPrev.addEventListener('click', prev)

  ctx.els.btnShuffle.addEventListener('click', () => {
    ctx.state.shuffle = !ctx.state.shuffle
    ctx.els.btnShuffle.classList.toggle('toggled', ctx.state.shuffle)
    ctx.toast(ctx.state.shuffle ? 'Reproduccion aleatoria activada' : 'Reproduccion aleatoria desactivada')
  })

  ctx.els.btnRepeat.addEventListener('click', () => {
    const order = ['off', 'all', 'one']
    const i = order.indexOf(ctx.state.repeat)
    ctx.state.repeat = order[(i + 1) % order.length]
    ctx.els.btnRepeat.classList.toggle('toggled', ctx.state.repeat !== 'off')
    ctx.els.btnRepeat.title =
      ctx.state.repeat === 'one' ? 'Repetir una' : ctx.state.repeat === 'all' ? 'Repetir todo' : 'Repetir'
    // Indicador "1" sobre el icono de repeticion.
    ctx.els.btnRepeat.dataset.mode = ctx.state.repeat
  })

  // Eventos provenientes de los motores externos.
  ctx.on('external-ended', () => next(true))
  ctx.on('external-play-state', (playing) => setPlaying(playing))
}

// ---------------------------------------------------------------------
// Eventos del elemento <audio>
// ---------------------------------------------------------------------
function wireAudioEvents() {
  audio.addEventListener('ended', () => next(true))
  audio.addEventListener('loadedmetadata', updateProgressUI)
  audio.addEventListener('pause', () => {
    if (getCurrent()?.source === 'local') {
      ctx.state.isPlaying = false
      ctx.els.iconPlay.hidden = false
      ctx.els.iconPause.hidden = true
      ctx.els.btnPlay.classList.remove('playing')
      ctx.emit('play-state', false)
    }
  })
  audio.addEventListener('play', () => {
    if (getCurrent()?.source === 'local') setPlaying(true)
  })
  audio.addEventListener('error', () => {
    if (getCurrent()?.source === 'local') ctx.toast('Error al cargar el archivo de audio.')
  })
}
