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
//   source -> [eq filters en serie] -> analyser -> destination
// El ecualizador es opcional: si no esta configurado, source se conecta
// directamente al analyser y el sonido pasa sin tocar.
let audioCtx = null
let analyser = null
let sourceNode = null
let eqFilters = [] // array de BiquadFilterNode (uno por banda)
let eqEnabled = false
let bassShelf = null // lowshelf de realce de graves (post-analyser)
let bassBoostDb = 5 // realce de graves por defecto (calido, sin saturar)

// Analyser independiente alimentado por la captura de audio del sistema
// (loopback) para visualizar Spotify / YouTube. Se inicia bajo demanda en
// la primera reproduccion externa y se reusa despues.
let loopbackAnalyser = null
let loopbackStream = null
let loopbackSource = null
let loopbackRequested = false

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
    playFromQueue,
    togglePlay,
    pause,
    next,
    prev,
    seekToFraction,
    setVolume,
    getFrequencyData,
    getTimeDomainData,
    getCurrent,
    getPlaybackTimes,
    setBassBoost,
    isLocalActive: () => getCurrent()?.source === 'local' && ctx.state.isPlaying,
  }

  // Ecualizador: API independiente para que el panel de Settings lo controle
  // sin tener que conocer el grafo interno.
  ctx.eq = {
    apply: applyEqBands, // (bandsArray) => void
    setEnabled: setEqEnabled,
    isEnabled: () => eqEnabled,
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

  // --- Realce de graves "fiesta" + limitador de seguridad ---
  // El bass boost va DESPUES del analyser para que el visualizador siga
  // leyendo la senal cruda (sin falsear el espectro) y para que la cadena
  // del ecualizador (source -> filtros -> analyser) no lo pise nunca.
  //   analyser -> bassShelf -> subPeak -> limiter -> destino
  bassShelf = audioCtx.createBiquadFilter()
  bassShelf.type = 'lowshelf'
  bassShelf.frequency.value = 110
  bassShelf.gain.value = bassBoostDb // realce calido de graves

  const subPeak = audioCtx.createBiquadFilter()
  subPeak.type = 'peaking'
  subPeak.frequency.value = 55 // golpe de sub-bass envolvente
  subPeak.Q.value = 0.9
  subPeak.gain.value = bassBoostDb * 0.6

  // Limitador transparente: solo actua en los picos, evita el clipping que
  // produciria el realce de graves en temas ya masterizados fuerte.
  const limiter = audioCtx.createDynamicsCompressor()
  limiter.threshold.value = -1.5
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.002
  limiter.release.value = 0.2

  sourceNode.connect(analyser)
  analyser.connect(bassShelf)
  bassShelf.connect(subPeak)
  subPeak.connect(limiter)
  limiter.connect(audioCtx.destination)

  window._aeroAnalyser = analyser
  // Si el panel de settings ya pidio bandas antes de que existiera el grafo,
  // las aplicamos ahora.
  if (pendingBands) {
    applyEqBands(pendingBands)
    pendingBands = null
  }
}

// Espera que arranque el AudioContext: si todavia no existe (no se ha
// reproducido nada local) lo creamos solo para poder configurar el EQ
// sin necesidad de tener una pista en curso.
let pendingBands = null
function ensureGraphForEq() {
  if (audioCtx) return true
  try {
    ensureAudioGraph()
    return true
  } catch {
    return false
  }
}

// Reconfigura la cadena de filtros del ecualizador.
//   bands: [{ freq: 30, gain: -12..+12, type?: 'lowshelf'|'peaking'|'highshelf' }]
// Reconecta source -> filter1 -> ... -> analyser. Si la lista esta vacia o el
// EQ esta desactivado, vuelve a la conexion directa source -> analyser.
let lastBands = null
function applyEqBands(bands) {
  if (bands) lastBands = bands
  if (!audioCtx) {
    pendingBands = bands || lastBands
    return
  }
  // Si el EQ esta apagado solo guardamos las bandas; evita disconnect/reconnect
  // del grafo en vivo, que puede causar microcortes audibles durante la edicion.
  if (!eqEnabled) {
    if (eqFilters.length) {
      try { sourceNode.disconnect() } catch {}
      eqFilters.forEach((f) => { try { f.disconnect() } catch {} })
      eqFilters = []
      sourceNode.connect(analyser)
    }
    return
  }

  // EQ encendido: si el numero de bandas coincide, actualizamos in-place
  // (cambiar gain de un BiquadFilter no produce click). Solo reconectamos
  // cuando cambia el numero de filtros.
  if (eqFilters.length === (bands ? bands.length : 0) && bands && bands.length) {
    bands.forEach((b, i) => {
      const f = eqFilters[i]
      if (f.frequency.value !== b.freq) f.frequency.value = b.freq
      const target = Math.max(-18, Math.min(18, b.gain || 0))
      // setTargetAtTime suaviza el cambio para evitar zippers al arrastrar
      try {
        f.gain.setTargetAtTime(target, audioCtx.currentTime, 0.015)
      } catch {
        f.gain.value = target
      }
    })
    return
  }

  try { sourceNode.disconnect() } catch {}
  eqFilters.forEach((f) => { try { f.disconnect() } catch {} })

  if (!bands || !bands.length) {
    sourceNode.connect(analyser)
    eqFilters = []
    return
  }

  // Crea filtros nuevos (mas barato que reusar y rearmar)
  eqFilters = bands.map((b, i) => {
    const node = audioCtx.createBiquadFilter()
    if (i === 0) node.type = 'lowshelf'
    else if (i === bands.length - 1) node.type = 'highshelf'
    else node.type = 'peaking'
    node.frequency.value = b.freq
    node.Q.value = 1.1
    node.gain.value = Math.max(-18, Math.min(18, b.gain || 0))
    return node
  })

  // source -> f0 -> f1 -> ... -> analyser
  let prev = sourceNode
  for (const f of eqFilters) {
    prev.connect(f)
    prev = f
  }
  prev.connect(analyser)
}

function setEqEnabled(on, bands) {
  eqEnabled = !!on
  const use = bands || lastBands || []
  if (audioCtx) applyEqBands(use)
  else if (use.length) pendingBands = use
}

// Ajusta el realce de graves (en dB). El shelf principal toma el valor y el
// pico de sub-bass un 60% para reforzar el cuerpo sin emborronar.
function setBassBoost(db) {
  bassBoostDb = Math.max(0, Math.min(12, Number(db) || 0))
  if (bassShelf && audioCtx) {
    try {
      bassShelf.gain.setTargetAtTime(bassBoostDb, audioCtx.currentTime, 0.02)
    } catch {
      bassShelf.gain.value = bassBoostDb
    }
  }
}

// Devuelve el analyser que esta sonando en este momento. Para local usa el
// analyser del grafo propio; para Spotify/YouTube usa el de la captura de
// audio del sistema (si esta lista).
function activeAnalyser() {
  const cur = getCurrent()
  if (!cur || !ctx.state.isPlaying) return null
  if (cur.source === 'local') return analyser
  return loopbackAnalyser // puede ser null si aun no se autorizo la captura
}

function getFrequencyData() {
  const a = activeAnalyser()
  if (!a) return null
  const arr = new Uint8Array(a.frequencyBinCount)
  a.getByteFrequencyData(arr)
  return arr
}

function getTimeDomainData() {
  const a = activeAnalyser()
  if (!a) return null
  const arr = new Uint8Array(a.fftSize)
  a.getByteTimeDomainData(arr)
  return arr
}

// ---------------------------------------------------------------------
// Captura de audio del sistema (para visualizador en YouTube/Spotify)
// ---------------------------------------------------------------------
async function ensureLoopbackAnalyser() {
  if (loopbackAnalyser || loopbackRequested) return
  // En Tauri (WebView2) no existe el handler de loopback del proceso principal
  // de Electron, asi que getDisplayMedia abriria el selector de pantalla nativo
  // del sistema. Lo omitimos: el visualizador usa su modo sintetico para las
  // fuentes externas (Spotify / YouTube), sin molestar al usuario con un popup.
  if (window.__TAURI_INTERNALS__) { loopbackRequested = true; return }
  loopbackRequested = true
  try {
    // El main process aprueba esta peticion con audio: 'loopback'.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    })
    // Descartamos cualquier pista de video; solo nos interesa el audio.
    stream.getVideoTracks().forEach((t) => t.stop())
    const audioTracks = stream.getAudioTracks()
    if (!audioTracks.length) {
      loopbackRequested = false
      return
    }
    const AC = window.AudioContext || window.webkitAudioContext
    const lbCtx = audioCtx || new AC()
    if (!audioCtx) audioCtx = lbCtx
    loopbackStream = new MediaStream(audioTracks)
    loopbackSource = lbCtx.createMediaStreamSource(loopbackStream)
    loopbackAnalyser = lbCtx.createAnalyser()
    loopbackAnalyser.fftSize = 2048
    loopbackAnalyser.smoothingTimeConstant = 0.78
    // No conectamos a destination para no devolver el audio (evita el bucle
    // de retroalimentacion; solo se usa para visualizar).
    loopbackSource.connect(loopbackAnalyser)
  } catch (err) {
    // Si el usuario o el sistema niegan la captura, queda en null y el
    // visualizador volvera a su modo sintetico para esa pista.
    loopbackRequested = false
  }
}

// ---------------------------------------------------------------------
// Reproduccion
//
// Modelo tipo Spotify: reproducir una pista NO la mete en la cola. La cola
// (ctx.state.queue) es una lista manual que el usuario arma a mano y que tiene
// prioridad en "siguiente". La navegacion normal usa la lista de contexto
// (ctx.state.context) que es la vista desde la que se empezo a reproducir.
// ---------------------------------------------------------------------
function getCurrent() {
  return ctx.state.currentTrack || null
}

// Reproduce una pista. context = { list, index } fija la lista de navegacion.
async function playItem(item, context) {
  if (!item) return
  ctx.state.currentTrack = item
  ctx.state.currentId = item.id
  if (context && Array.isArray(context.list)) {
    ctx.state.context = { list: context.list, index: context.index ?? 0 }
  }

  // Detiene cualquier motor externo antes de cambiar de fuente.
  stopExternalEngines(item.source)

  if (item.source === 'local') await loadLocal(item)
  else if (item.source === 'youtube') loadYouTube(item)
  else if (item.source === 'spotify') loadSpotify(item)

  // Para fuentes externas, intenta activar la captura del audio del sistema
  // para que el visualizador reaccione a la musica real. Solo se solicita una
  // vez por sesion; despues se reutiliza la misma corriente.
  if (item.source !== 'local') ensureLoopbackAnalyser()

  updateNowPlaying(item)
  ctx.emit('track-changed', item)
}

// Reproduce un item de la cola manual y lo consume (se quita de la cola).
function playFromQueue(item) {
  ctx.state.queue = ctx.state.queue.filter((i) => i.id !== item.id)
  ctx.emit('queue-changed')
  ctx.updateStatusBar()
  playItem(item)
}

// Reproduce por id desde la cola manual (compatibilidad).
function playId(id) {
  const item = ctx.state.queue.find((i) => i.id === id)
  if (item) playFromQueue(item)
}

// Reproduce un indice de la lista de contexto.
function playFromContext(index) {
  const c = ctx.state.context
  if (!c || !c.list[index]) return
  c.index = index
  playItem(c.list[index])
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
    // Sin pista activa: arranca la cola manual o, en su defecto, el contexto.
    if (ctx.state.queue.length) playFromQueue(ctx.state.queue[0])
    else if (ctx.state.context?.list?.length) playFromContext(0)
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
  if (ctx.state.repeat === 'one' && auto) {
    const cur = getCurrent()
    if (cur) playItem(cur)
    return
  }
  // 1) La cola manual tiene prioridad y se consume.
  if (ctx.state.queue.length) {
    const it = ctx.state.queue.shift()
    ctx.emit('queue-changed')
    ctx.updateStatusBar()
    playItem(it)
    return
  }
  // 2) Continua en la lista de contexto.
  const c = ctx.state.context
  if (c && c.list.length) {
    if (ctx.state.shuffle) {
      playFromContext(randomIndexExcept(c.list.length, c.index))
      return
    }
    let ni = c.index + 1
    if (ni >= c.list.length) {
      if (ctx.state.repeat === 'all') ni = 0
      else {
        setPlaying(false)
        return
      }
    }
    playFromContext(ni)
    return
  }
  setPlaying(false)
}

function prev() {
  // Si han pasado mas de 3s, reinicia la pista actual.
  if (getCurrent()?.source === 'local' && audio.currentTime > 3) {
    audio.currentTime = 0
    return
  }
  const c = ctx.state.context
  if (c && c.list.length) {
    let pi = c.index - 1
    if (pi < 0) pi = ctx.state.repeat === 'all' ? c.list.length - 1 : 0
    playFromContext(pi)
  }
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
  // El swap visual se hace por CSS via la clase .playing del boton.
  // Tambien limpiamos cualquier hidden inline que pudiera haber quedado.
  if (ctx.els.iconPlay) ctx.els.iconPlay.removeAttribute('hidden')
  if (ctx.els.iconPause) ctx.els.iconPause.removeAttribute('hidden')
  ctx.els.btnPlay.classList.toggle('playing', playing)
  ctx.els.btnPlay.title = playing ? 'Pausar' : 'Reproducir'
  ctx.els.btnPlay.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir')
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
    if (getCurrent()?.source === 'local') setPlaying(false)
  })
  audio.addEventListener('play', () => {
    if (getCurrent()?.source === 'local') setPlaying(true)
  })
  audio.addEventListener('error', () => {
    if (getCurrent()?.source === 'local') ctx.toast('Error al cargar el archivo de audio.')
  })
}
