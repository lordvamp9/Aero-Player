/* =====================================================================
   AERO PLAYER  ·  visualizer.js
   Cuatro modos de visualizacion sobre Canvas 2D. Usa datos FFT reales del
   AnalyserNode cuando hay audio local; en caso contrario genera un modo
   demo animado para que el escenario nunca se vea estatico.
     1. liquid    Ondas liquidas (por defecto)
     2. spectrum  Espectro de frecuencias con reflexion
     3. waveform  Forma de onda en tres capas
     4. orbital   Particulas orbitales reactivas al bass
   ===================================================================== */

let ctx // contexto de la app
let canvas
let g // contexto 2d
let width = 0
let height = 0
let dpr = 1

let rafId = null
let mode = 'liquid'
let fade = 1 // opacidad de transicion entre modos (0 -> 1)
let t = 0 // reloj de animacion

// Estado de cada modo
let particles = [] // liquid: motas ascendentes
let bigOrbs = []   // liquid + waveform: orbes grandes flotantes
let orbiters = [] // orbital
let peaks = [] // spectrum: caida de picos
const BIN_COUNT = 1024

// --- Detector de beat ---------------------------------------------------
// Mantiene una EMA del bass para estimar la energia "normal" y dispara un
// kick cuando la lectura instantanea la supera con margen. El valor se
// suaviza con un envelope que decae, asi todas las ondas pueden engancharse
// al mismo ritmo sin parecer agitadas.
let bassEMA = 0.05      // promedio movil del bass
let bassVar = 0.001     // varianza estimada (para umbral adaptativo)
let beatEnvelope = 0    // 0..1, decae tras cada kick
let beatHoldoff = 0     // frames de espera para no doblar el kick
let smoothEnergy = 0    // energia general suavizada (para visibilidad continua)

export function initVisualizer(context) {
  ctx = context
  canvas = ctx.els.canvas
  g = canvas.getContext('2d', { alpha: true })
  mode = ctx.state.visualizerMode || 'liquid'

  resize()
  window.addEventListener('resize', resize)
  initParticles()
  initBigOrbs()
  initOrbiters()
  peaks = new Array(96).fill(0)

  wireSelector()

  ctx.visualizer = {
    start,
    stop,
    setMode,
  }
  highlightSelector()
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = canvas.getBoundingClientRect()
  width = Math.max(1, Math.floor(rect.width))
  height = Math.max(1, Math.floor(rect.height))
  canvas.width = width * dpr
  canvas.height = height * dpr
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function wireSelector() {
  ctx.els.vizSelector.querySelectorAll('.viz-mode').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode))
  })
}

function setMode(next) {
  if (next === mode) return
  mode = next
  fade = 0
  ctx.state.visualizerMode = next
  ctx.persist.config()
  highlightSelector()
}

function highlightSelector() {
  ctx.els.vizSelector.querySelectorAll('.viz-mode').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode)
  })
}

function start() {
  if (rafId) return
  const loop = () => {
    t += 1
    if (fade < 1) fade = Math.min(1, fade + 0.05)
    draw()
    rafId = requestAnimationFrame(loop)
  }
  rafId = requestAnimationFrame(loop)
}

function stop() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = null
}

// ---------------------------------------------------------------------
// Origen de datos: real (AnalyserNode) o demo sintetico
// ---------------------------------------------------------------------
function getFrequency() {
  const real = ctx.player && ctx.player.getFrequencyData()
  if (real) return real
  return syntheticFrequency()
}

function getWave() {
  const real = ctx.player && ctx.player.getTimeDomainData()
  if (real) return real
  return syntheticWave()
}

// Espectro demo: graves dominantes con un latido animado y armonicos.
function syntheticFrequency() {
  const arr = new Uint8Array(BIN_COUNT)
  const beat = 0.55 + 0.45 * Math.pow(Math.abs(Math.sin(t * 0.018)), 2)
  for (let i = 0; i < BIN_COUNT; i++) {
    const norm = i / BIN_COUNT
    const envelope = Math.pow(1 - norm, 1.7) // mas energia en graves
    const wobble =
      0.5 +
      0.5 *
        Math.sin(t * 0.04 + i * 0.18) *
        Math.sin(t * 0.013 + i * 0.05) *
        Math.cos(t * 0.027 + norm * 6)
    let v = 235 * envelope * beat * (0.45 + 0.55 * wobble)
    if (i < 6) v *= 1.15
    arr[i] = Math.max(0, Math.min(255, v))
  }
  return arr
}

// Onda demo: suma de senos a distintas frecuencias.
function syntheticWave() {
  const N = 2048
  const arr = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const x = i / N
    const s =
      Math.sin(x * Math.PI * 6 + t * 0.05) * 0.5 +
      Math.sin(x * Math.PI * 13 - t * 0.03) * 0.25 +
      Math.sin(x * Math.PI * 23 + t * 0.07) * 0.12
    arr[i] = 128 + s * 95
  }
  return arr
}

function bassEnergy(freq) {
  let sum = 0
  const n = 40
  for (let i = 0; i < n; i++) sum += freq[i]
  return sum / (n * 255) // 0..1
}

// Calcula energia + detecta beat. Devuelve un objeto con valores listos para
// ser usados por todos los modos: energy (suave), kick (envelope del beat),
// pulse (mezcla de ambos para "respiracion") y raw (bass instantaneo).
function getPulse(freq) {
  const raw = bassEnergy(freq)

  // EMA + varianza para umbral adaptativo
  const alpha = 0.05
  const delta = raw - bassEMA
  bassEMA += delta * alpha
  bassVar += (delta * delta - bassVar) * alpha
  const std = Math.sqrt(bassVar)
  const threshold = bassEMA + Math.max(0.05, std * 1.6)

  // Energia general suavizada (sin saltos bruscos)
  smoothEnergy += (raw - smoothEnergy) * 0.18

  // Decae el envelope del beat anterior
  beatEnvelope *= 0.88
  if (beatHoldoff > 0) beatHoldoff--

  // Detecta nuevo beat
  if (raw > threshold && raw > 0.18 && beatHoldoff === 0) {
    beatEnvelope = Math.min(1, beatEnvelope + 0.85)
    beatHoldoff = 8 // ~130ms a 60fps, evita doblar el mismo golpe
  }

  return {
    energy: smoothEnergy,
    kick: beatEnvelope,
    pulse: smoothEnergy * 0.6 + beatEnvelope * 0.55,
    raw,
  }
}

// ---------------------------------------------------------------------
// Dibujo principal
// ---------------------------------------------------------------------
function draw() {
  g.globalAlpha = 1
  switch (mode) {
    case 'spectrum':
      clearBackground()
      g.globalAlpha = fade
      drawSpectrum()
      break
    case 'waveform':
      trail(0.18)
      g.globalAlpha = fade
      drawWaveform()
      break
    case 'orbital':
      trail(0.14)
      g.globalAlpha = fade
      drawOrbital()
      break
    case 'liquid':
    default:
      clearBackground()
      g.globalAlpha = fade
      drawLiquid()
      break
  }
  g.globalAlpha = 1
}

// Fondo solido con leve gradiente (modos sin estela)
function clearBackground() {
  g.clearRect(0, 0, width, height)
  const grad = g.createLinearGradient(0, 0, 0, height)
  grad.addColorStop(0, 'rgba(7, 18, 46, 0.30)')
  grad.addColorStop(1, 'rgba(2, 7, 20, 0.55)')
  g.fillStyle = grad
  g.fillRect(0, 0, width, height)
}

// Estela: rectangulo translucido para dejar rastro de movimiento
function trail(alpha) {
  g.fillStyle = `rgba(3, 9, 22, ${alpha})`
  g.fillRect(0, 0, width, height)
}

// ---------------------------------------------------------------------
// MODO 1 · ONDAS LIQUIDAS
// ---------------------------------------------------------------------
function drawLiquid() {
  const freq = getFrequency()
  const { energy, kick, pulse } = getPulse(freq)

  // Glow radial que respira con el beat (mas notorio en cada kick)
  const glow = g.createRadialGradient(
    width / 2,
    height * 1.05,
    0,
    width / 2,
    height * 1.05,
    height * (0.75 + pulse * 0.3)
  )
  glow.addColorStop(0, `rgba(70, 140, 245, ${0.12 + pulse * 0.28})`)
  glow.addColorStop(0.55, `rgba(40, 95, 210, ${0.05 + pulse * 0.12})`)
  glow.addColorStop(1, 'rgba(40, 95, 210, 0)')
  g.fillStyle = glow
  g.fillRect(0, 0, width, height)

  // Ondas con amplitudes mas notorias y alpha mayor. Cada capa reacciona al
  // beat con un boost adicional, asi se nota la pulsacion del tema.
  const layers = [
    { amp: 26, speed: 0.018, freqX: 1.2, phase: 0.0, alpha: 0.10, base: 0.76, hue: 0 },
    { amp: 34, speed: 0.014, freqX: 1.6, phase: 1.3, alpha: 0.11, base: 0.82, hue: 8 },
    { amp: 22, speed: 0.022, freqX: 2.2, phase: 2.6, alpha: 0.12, base: 0.88, hue: 18 },
    { amp: 38, speed: 0.012, freqX: 1.0, phase: 3.7, alpha: 0.10, base: 0.93, hue: 26 },
    { amp: 18, speed: 0.028, freqX: 3.0, phase: 4.9, alpha: 0.13, base: 0.97, hue: 34 },
  ]

  layers.forEach((L, li) => {
    // Cada capa engancha distinto al beat: las del fondo responden mas que
    // las cercanas, lo que da sensacion de profundidad pulsante.
    const beatBoost = 1 + energy * 0.9 + kick * (0.4 + li * 0.18)
    const baseY = height * L.base - kick * 6 * (li + 1) * 0.5
    g.beginPath()
    g.moveTo(0, height)
    for (let x = 0; x <= width; x += 6) {
      const nx = x / width
      const y =
        baseY -
        Math.sin(nx * Math.PI * L.freqX * 2 + t * L.speed + L.phase) * L.amp * beatBoost -
        Math.sin(nx * Math.PI * L.freqX * 5 + t * L.speed * 1.7) * (L.amp * 0.28) * beatBoost
      g.lineTo(x, y)
    }
    g.lineTo(width, height)
    g.closePath()

    const grad = g.createLinearGradient(0, baseY - 80, 0, height)
    const r = 60 + li * 10
    const gC = 140 + li * 14 + L.hue
    grad.addColorStop(0, `rgba(${r}, ${gC}, 240, ${L.alpha + pulse * 0.12})`)
    grad.addColorStop(1, 'rgba(30, 70, 200, 0)')
    g.fillStyle = grad
    g.fill()

    // Cresta luminosa: ahora si destaca con el beat
    g.beginPath()
    for (let x = 0; x <= width; x += 6) {
      const nx = x / width
      const y =
        baseY -
        Math.sin(nx * Math.PI * L.freqX * 2 + t * L.speed + L.phase) * L.amp * beatBoost -
        Math.sin(nx * Math.PI * L.freqX * 5 + t * L.speed * 1.7) * (L.amp * 0.28) * beatBoost
      if (x === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.strokeStyle = `rgba(${160 + li * 6}, ${200 + li * 6}, 255, ${0.18 + pulse * 0.45})`
    g.lineWidth = 1.1 + pulse * 0.9
    if (kick > 0.2) {
      g.shadowColor = `rgba(120, 190, 255, ${0.45 * kick})`
      g.shadowBlur = 8 + kick * 14
    }
    g.stroke()
    g.shadowBlur = 0
  })

  drawBigOrbs(pulse, kick)
  drawParticles(energy + kick * 0.6)
}

function initParticles() {
  particles = []
  for (let i = 0; i < 42; i++) particles.push(newParticle(true))
}

// Orbes gigantes que flotan en el escenario. Reaccionan al beat aumentando
// su radio momentaneamente y se desplazan lentamente, generando ese aire de
// "burbujas de cristal" que combina con la estetica Aero Liquid Glass.
function initBigOrbs() {
  bigOrbs = []
  const palette = [
    { r: 70, g: 150, b: 255 },
    { r: 130, g: 200, b: 255 },
    { r: 80, g: 120, b: 235 },
    { r: 160, g: 215, b: 255 },
    { r: 60, g: 105, b: 230 },
  ]
  for (let i = 0; i < 6; i++) {
    const c = palette[i % palette.length]
    bigOrbs.push({
      x: Math.random(),
      y: 0.3 + Math.random() * 0.55,
      baseR: 60 + Math.random() * 80,
      r: 0,
      vx: (Math.random() - 0.5) * 0.00035,
      vy: (Math.random() - 0.5) * 0.00025,
      phase: Math.random() * Math.PI * 2,
      hue: c,
    })
  }
}

function drawBigOrbs(pulse, kick) {
  bigOrbs.forEach((o) => {
    o.x += o.vx
    o.y += o.vy + Math.sin(t * 0.004 + o.phase) * 0.0006
    o.phase += 0.002
    if (o.x < -0.15) o.x = 1.15
    if (o.x > 1.15) o.x = -0.15
    if (o.y < 0.1) o.y = 0.85
    if (o.y > 0.95) o.y = 0.15

    // Radio responde al pulse y al kick puntual del beat
    const target = o.baseR * (1 + pulse * 0.55 + kick * 0.45)
    o.r += (target - o.r) * 0.12

    const px = o.x * width
    const py = o.y * height
    const grad = g.createRadialGradient(px, py, 0, px, py, o.r)
    grad.addColorStop(0, `rgba(${o.hue.r}, ${o.hue.g}, ${o.hue.b}, ${0.35 + pulse * 0.25})`)
    grad.addColorStop(0.55, `rgba(${o.hue.r}, ${o.hue.g}, ${o.hue.b}, ${0.08 + pulse * 0.12})`)
    grad.addColorStop(1, `rgba(${o.hue.r}, ${o.hue.g}, ${o.hue.b}, 0)`)
    g.fillStyle = grad
    g.beginPath()
    g.arc(px, py, o.r, 0, Math.PI * 2)
    g.fill()

    // Reflejo brillante del orbe (highlight en la parte superior izquierda)
    const hi = g.createRadialGradient(px - o.r * 0.35, py - o.r * 0.4, 0, px - o.r * 0.35, py - o.r * 0.4, o.r * 0.45)
    hi.addColorStop(0, `rgba(255, 255, 255, ${0.16 + kick * 0.18})`)
    hi.addColorStop(1, 'rgba(255, 255, 255, 0)')
    g.fillStyle = hi
    g.beginPath()
    g.arc(px - o.r * 0.35, py - o.r * 0.4, o.r * 0.45, 0, Math.PI * 2)
    g.fill()
  })
}
function newParticle(spread) {
  return {
    x: Math.random(),
    y: spread ? Math.random() : 1.05,
    r: 0.6 + Math.random() * 1.8,
    speed: 0.0008 + Math.random() * 0.0016,
    drift: (Math.random() - 0.5) * 0.0006,
    life: Math.random(),
  }
}
function drawParticles(energy) {
  particles.forEach((p) => {
    p.y -= p.speed * (1 + energy * 1.5)
    p.x += p.drift
    p.life += 0.01
    if (p.y < -0.05) Object.assign(p, newParticle(false))
    const px = p.x * width
    const py = p.y * height
    const a = (0.12 + 0.32 * Math.abs(Math.sin(p.life))) * (0.5 + energy)
    g.beginPath()
    g.arc(px, py, p.r * 0.85, 0, Math.PI * 2)
    g.fillStyle = `rgba(175, 212, 255, ${Math.min(0.4, a)})`
    g.shadowColor = 'rgba(120, 180, 255, 0.45)'
    g.shadowBlur = 4
    g.fill()
    g.shadowBlur = 0
  })
}

// ---------------------------------------------------------------------
// MODO 2 · ESPECTRO DE FRECUENCIAS
// ---------------------------------------------------------------------
function drawSpectrum() {
  const freq = getFrequency()
  const { kick, pulse, energy } = getPulse(freq)
  const bars = 96
  const gap = 2
  const barW = (width - gap * (bars - 1)) / bars
  const mid = height * 0.66 // linea base (espacio para reflexion abajo)
  const step = Math.floor((freq.length * 0.7) / bars)
  const headroom = mid - 14

  // Halo de fondo radial que late con cada beat
  const halo = g.createRadialGradient(width / 2, mid, 10, width / 2, mid, width * (0.5 + pulse * 0.25))
  halo.addColorStop(0, `rgba(70, 145, 255, ${0.12 + pulse * 0.28})`)
  halo.addColorStop(1, 'rgba(70, 145, 255, 0)')
  g.fillStyle = halo
  g.fillRect(0, 0, width, height)

  // Linea horizontal sutil de la base (suelo del espectro)
  g.strokeStyle = `rgba(120, 180, 255, ${0.12 + pulse * 0.1})`
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(0, mid + 0.5)
  g.lineTo(width, mid + 0.5)
  g.stroke()

  for (let i = 0; i < bars; i++) {
    let v = 0
    for (let j = 0; j < step; j++) v += freq[i * step + j]
    v = v / step / 255 // 0..1
    v = Math.pow(v, 1.05) // curva mas dramatica que antes
    // Boost adicional con el beat para que se "abran" en cada golpe
    const h = Math.min(headroom, v * headroom * (1.05 + kick * 0.55 + energy * 0.25))
    const x = i * (barW + gap)
    const top = mid - h

    // Caida suave de picos
    if (h > peaks[i]) peaks[i] = h
    else peaks[i] = Math.max(0, peaks[i] - 1.8)

    // Barra principal con gradiente vertical mas vibrante
    const grad = g.createLinearGradient(0, mid, 0, top)
    grad.addColorStop(0, 'rgba(18, 52, 155, 0.95)')
    grad.addColorStop(0.5, 'rgba(50, 120, 240, 0.96)')
    grad.addColorStop(0.85, 'rgba(120, 195, 255, 1)')
    grad.addColorStop(1, 'rgba(200, 232, 255, 1)')
    g.fillStyle = grad
    if (h > headroom * 0.5) {
      g.shadowColor = 'rgba(110, 190, 255, 0.85)'
      g.shadowBlur = 16 + kick * 12
    }
    roundRectFill(x, top, barW, h, Math.min(barW / 2, 3))
    g.shadowBlur = 0

    // Highlight superior (brillo vidrioso en la punta de la barra)
    const hi = g.createLinearGradient(0, top, 0, top + Math.min(10, h))
    hi.addColorStop(0, 'rgba(255, 255, 255, 0.55)')
    hi.addColorStop(1, 'rgba(255, 255, 255, 0)')
    g.fillStyle = hi
    roundRectFill(x, top, barW, Math.min(10, h), Math.min(barW / 2, 3))

    // Indicador de pico con glow propio
    g.fillStyle = `rgba(220, 240, 255, ${0.9 + kick * 0.1})`
    g.shadowColor = 'rgba(150, 210, 255, 0.7)'
    g.shadowBlur = 6
    g.fillRect(x, mid - peaks[i] - 2, barW, 2.4)
    g.shadowBlur = 0

    // Reflexion espejada con desvanecimiento
    const refGrad = g.createLinearGradient(0, mid, 0, mid + h * 0.7)
    refGrad.addColorStop(0, 'rgba(80, 160, 240, 0.45)')
    refGrad.addColorStop(0.5, 'rgba(50, 120, 220, 0.18)')
    refGrad.addColorStop(1, 'rgba(40, 100, 200, 0)')
    g.fillStyle = refGrad
    roundRectFill(x, mid + 2, barW, h * 0.7, Math.min(barW / 2, 3))
  }

  // Orbes gigantes flotando detras (capa atmosferica de la estetica Aero)
  drawBigOrbs(pulse, kick)
  drawParticles(energy + kick * 0.4)
}

// ---------------------------------------------------------------------
// MODO 3 · FORMA DE ONDA
// ---------------------------------------------------------------------
function drawWaveform() {
  const wave = getWave()
  const freq = getFrequency()
  const { kick, pulse } = getPulse(freq)
  const mid = height / 2

  // Tunel de luz que crece con el beat
  const tunnel = g.createRadialGradient(width / 2, mid, 10, width / 2, mid, width * (0.55 + pulse * 0.2))
  tunnel.addColorStop(0, `rgba(60, 130, 240, ${0.14 + pulse * 0.22})`)
  tunnel.addColorStop(1, 'rgba(30, 90, 210, 0)')
  g.fillStyle = tunnel
  g.fillRect(0, 0, width, height)

  // Amplitud aumenta con la energia; las capas externas marcan el latido
  const amp = height * (0.32 + pulse * 0.18)
  const layers = [
    { off: -14 - kick * 6, w: 1.2, a: 0.35 + pulse * 0.25 },
    { off: 14 + kick * 6, w: 1.2, a: 0.35 + pulse * 0.25 },
    { off: 0, w: 2.6 + kick * 1.6, a: 1 }, // capa central mas gruesa con glow
  ]

  layers.forEach((L) => {
    g.beginPath()
    const slice = wave.length / width
    for (let x = 0; x <= width; x++) {
      const idx = Math.floor(x * slice)
      const v = (wave[idx] - 128) / 128
      const y = mid + L.off + v * amp
      if (x === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.strokeStyle =
      L.w > 2 ? `rgba(170, 215, 255, ${0.9 + kick * 0.1})` : `rgba(110, 175, 255, ${L.a})`
    g.lineWidth = L.w
    if (L.w > 2) {
      g.shadowColor = `rgba(90, 170, 255, ${0.7 + kick * 0.3})`
      g.shadowBlur = 14 + kick * 14
    }
    g.stroke()
    g.shadowBlur = 0
  })

  // Orbes flotantes detras de la onda
  drawBigOrbs(pulse, kick)
}

// ---------------------------------------------------------------------
// MODO 4 · PARTICULAS ORBITALES
// ---------------------------------------------------------------------
function initOrbiters() {
  orbiters = []
  for (let i = 0; i < 90; i++) {
    orbiters.push({
      angle: Math.random() * Math.PI * 2,
      radius: 30 + Math.random() * 180,
      baseRadius: 30 + Math.random() * 180,
      speed: (0.002 + Math.random() * 0.01) * (Math.random() < 0.5 ? 1 : -1),
      size: 0.8 + Math.random() * 2.4,
      hueShift: Math.random(),
    })
  }
}

function drawOrbital() {
  const freq = getFrequency()
  const { energy, kick } = getPulse(freq)
  const cx = width / 2
  const cy = height / 2

  // Nucleo brillante que late con el bass + cada kick lo hincha
  const coreR = 18 + energy * 60 + kick * 40
  const core = g.createRadialGradient(cx, cy, 0, cx, cy, coreR)
  core.addColorStop(0, `rgba(180, 220, 255, ${0.5 + energy * 0.4})`)
  core.addColorStop(1, 'rgba(40, 110, 235, 0)')
  g.fillStyle = core
  g.beginPath()
  g.arc(cx, cy, coreR, 0, Math.PI * 2)
  g.fill()

  orbiters.forEach((o, i) => {
    o.angle += o.speed * (1 + energy * 2)
    // El bass dispersa las particulas hacia afuera
    const target = o.baseRadius * (1 + energy * 1.6)
    o.radius += (target - o.radius) * 0.08
    const x = cx + Math.cos(o.angle) * o.radius
    const y = cy + Math.sin(o.angle) * o.radius * 0.7 // orbita eliptica

    // Color segun "frecuencia" asociada: graves azul oscuro, agudos claro
    const fv = freq[(i * 11) % freq.length] / 255
    const r = 60 + fv * 140
    const gg = 120 + fv * 110
    const b = 235
    const a = 0.4 + fv * 0.5

    // Estela corta
    const tx = cx + Math.cos(o.angle - o.speed * 6) * o.radius
    const ty = cy + Math.sin(o.angle - o.speed * 6) * o.radius * 0.7
    g.beginPath()
    g.moveTo(tx, ty)
    g.lineTo(x, y)
    g.strokeStyle = `rgba(${r | 0}, ${gg | 0}, ${b}, ${a * 0.4})`
    g.lineWidth = o.size * 0.7
    g.stroke()

    g.beginPath()
    g.arc(x, y, o.size * (1 + energy * 0.8), 0, Math.PI * 2)
    g.fillStyle = `rgba(${r | 0}, ${gg | 0}, ${b}, ${a})`
    g.shadowColor = 'rgba(120, 180, 255, 0.7)'
    g.shadowBlur = 8
    g.fill()
    g.shadowBlur = 0
  })
}

// ---------------------------------------------------------------------
// Utilidad: rectangulo con esquinas redondeadas
// ---------------------------------------------------------------------
function roundRectFill(x, y, w, h, r) {
  if (h <= 0) return
  r = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
  g.fill()
}
