/* =====================================================================
   AERO PLAYER  ·  intro-sound.js
   Sonido de arranque generado por completo con Web Audio (sin assets).
   Estetica "campana cristalina" clasica de los 2000 + un sub-bass
   envolvente que da ese golpe de fiesta. Todo se sintetiza al vuelo:
     - Sub-bass con barrido de tono (D1 -> D2) y swell -> el "boom"
     - Arpegio de campanas en Re mayor (D-A-D-F#) que queda sonando
     - Destello agudo (sparkle) y un whoosh de ruido filtrado ascendente
     - Reverb por convolucion con impulso sintetico -> espacio/aire
   Se reproduce una sola vez por arranque. Si el navegador bloquea el
   audio (autoplay), se engancha al primer gesto del usuario.
   ===================================================================== */

let played = false

export function playIntro() {
  if (played) return
  played = true

  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return

  let actx
  try {
    actx = new AC()
  } catch {
    return
  }

  const run = () => {
    try {
      buildAndPlay(actx)
    } catch (e) {
      console.warn('[intro] no se pudo reproducir el sonido de arranque:', e)
    }
  }

  if (actx.state === 'suspended') {
    // Autoplay bloqueado: intenta resumir; si no, espera el primer gesto.
    actx.resume().then(() => {
      if (actx.state === 'running') run()
      else armGesture(actx, run)
    }).catch(() => armGesture(actx, run))
  } else {
    run()
  }
}

// Engancha la reproduccion al primer gesto del usuario (una sola vez).
function armGesture(actx, run) {
  const fire = () => {
    cleanup()
    actx.resume().finally(run)
  }
  const cleanup = () => {
    window.removeEventListener('pointerdown', fire)
    window.removeEventListener('keydown', fire)
    window.removeEventListener('click', fire)
  }
  window.addEventListener('pointerdown', fire, { once: true })
  window.addEventListener('keydown', fire, { once: true })
  window.addEventListener('click', fire, { once: true })
}

function buildAndPlay(actx) {
  const now = actx.currentTime + 0.06
  const TAIL = 3.6 // duracion total estimada (para cerrar el contexto)

  // --- Cadena maestra: mezcla -> compresor suave -> salida ---
  const master = actx.createGain()
  master.gain.value = 0.0001

  const comp = actx.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.knee.value = 28
  comp.ratio.value = 3.2
  comp.attack.value = 0.004
  comp.release.value = 0.28

  master.connect(comp)
  comp.connect(actx.destination)

  // Swell global de entrada/salida (fade-in rapido, cola larga)
  master.gain.setValueAtTime(0.0001, now)
  master.gain.exponentialRampToValueAtTime(0.9, now + 0.12)
  master.gain.setValueAtTime(0.9, now + 1.6)
  master.gain.exponentialRampToValueAtTime(0.0001, now + TAIL - 0.2)

  // --- Reverb por convolucion (impulso sintetico) ---
  const convolver = actx.createConvolver()
  convolver.buffer = makeImpulse(actx, 2.4, 3.2)
  const wet = actx.createGain()
  wet.gain.value = 0.5
  convolver.connect(wet)
  wet.connect(master)

  const dry = actx.createGain()
  dry.gain.value = 0.85
  dry.connect(master)

  // Bus que alimenta seco + reverb
  const bus = actx.createGain()
  bus.connect(dry)
  bus.connect(convolver)

  // ----------------------------------------------------------------
  // 1) SUB-BASS envolvente: el "boom" de fiesta
  // ----------------------------------------------------------------
  // Oscilador principal con barrido de D1 (36.7) a D2 (73.4) + capa de
  // cuerpo una quinta arriba. Pasa por un lowpass para que sea redondo.
  const bassGain = actx.createGain()
  bassGain.gain.value = 0.0001
  const bassLP = actx.createBiquadFilter()
  bassLP.type = 'lowpass'
  bassLP.frequency.value = 220
  bassLP.Q.value = 0.7
  bassGain.connect(bassLP)
  bassLP.connect(bus)

  const sub = actx.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(36.71, now)
  sub.frequency.exponentialRampToValueAtTime(73.42, now + 0.5)
  sub.frequency.setValueAtTime(73.42, now + 1.4)

  // Pequeno armonico para que el sub se "oiga" en parlantes chicos
  const subHarm = actx.createOscillator()
  subHarm.type = 'triangle'
  subHarm.frequency.setValueAtTime(73.42, now)
  subHarm.frequency.exponentialRampToValueAtTime(146.83, now + 0.5)
  const harmGain = actx.createGain()
  harmGain.gain.value = 0.18
  subHarm.connect(harmGain)
  harmGain.connect(bassGain)

  // Envelope del sub: golpe con cuerpo y cola
  bassGain.gain.setValueAtTime(0.0001, now)
  bassGain.gain.exponentialRampToValueAtTime(0.95, now + 0.09)
  bassGain.gain.exponentialRampToValueAtTime(0.4, now + 0.9)
  bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4)

  sub.connect(bassGain)
  sub.start(now)
  subHarm.start(now)
  sub.stop(now + 2.5)
  subHarm.stop(now + 2.5)

  // ----------------------------------------------------------------
  // 2) ARPEGIO DE CAMPANAS en Re mayor: D4 A4 D5 F#5 ascendente
  // ----------------------------------------------------------------
  const bell = [
    { f: 293.66, t: 0.00 }, // D4
    { f: 440.0, t: 0.13 }, // A4
    { f: 587.33, t: 0.26 }, // D5
    { f: 739.99, t: 0.40 }, // F#5
  ]
  bell.forEach((n) => playBell(actx, bus, n.f, now + n.t))

  // Campana grave de cierre que refuerza la fundamental al final del arpegio
  playBell(actx, bus, 146.83, now + 0.40, 0.5)

  // ----------------------------------------------------------------
  // 3) DESTELLO agudo (sparkle): A6 + E7 cortos y brillantes
  // ----------------------------------------------------------------
  playBell(actx, bus, 1760.0, now + 0.52, 0.28, 'sine')
  playBell(actx, bus, 2637.0, now + 0.6, 0.2, 'sine')

  // ----------------------------------------------------------------
  // 4) WHOOSH de ruido filtrado ascendente: aire envolvente
  // ----------------------------------------------------------------
  const noise = actx.createBufferSource()
  noise.buffer = makeNoise(actx, 1.2)
  const bp = actx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 0.8
  bp.frequency.setValueAtTime(300, now)
  bp.frequency.exponentialRampToValueAtTime(4500, now + 0.7)
  const noiseGain = actx.createGain()
  noiseGain.gain.setValueAtTime(0.0001, now)
  noiseGain.gain.exponentialRampToValueAtTime(0.12, now + 0.35)
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1)
  noise.connect(bp)
  bp.connect(noiseGain)
  noiseGain.connect(wet) // solo al reverb, para que sea aire de fondo
  noise.start(now)
  noise.stop(now + 1.2)

  // Cierra el contexto al terminar para no dejar audio colgado.
  setTimeout(() => {
    try { actx.close() } catch {}
  }, (TAIL + 0.3) * 1000)
}

// Una campana: par de osciladores ligeramente desafinados (shimmer),
// ataque inmediato y caida exponencial larga. Pasa por un pico resonante
// para darle ese timbre metalico-cristalino.
function playBell(actx, dest, freq, at, level = 1, type = 'triangle') {
  const g = actx.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(0.32 * level, at + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 1.8)

  const peak = actx.createBiquadFilter()
  peak.type = 'peaking'
  peak.frequency.value = freq
  peak.Q.value = 3
  peak.gain.value = 6
  peak.connect(dest)
  g.connect(peak)

  const o1 = actx.createOscillator()
  o1.type = type
  o1.frequency.value = freq
  const o2 = actx.createOscillator()
  o2.type = 'sine'
  o2.frequency.value = freq * 2.0027 // octava + leve desafine -> brillo
  const o2g = actx.createGain()
  o2g.gain.value = 0.25
  o2.connect(o2g)
  o2g.connect(g)
  o1.connect(g)

  o1.start(at)
  o2.start(at)
  o1.stop(at + 1.9)
  o2.stop(at + 1.9)
}

// Impulso de reverb sintetico: ruido estereo con decaimiento exponencial.
function makeImpulse(actx, seconds, decay) {
  const rate = actx.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = actx.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, decay)
      data[i] = (Math.random() * 2 - 1) * env
    }
  }
  return buf
}

// Ruido blanco mono para el whoosh.
function makeNoise(actx, seconds) {
  const rate = actx.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = actx.createBuffer(1, len, rate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}
