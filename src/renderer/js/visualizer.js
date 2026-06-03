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
let orbiters = [] // orbital
let peaks = [] // spectrum: caida de picos
const BIN_COUNT = 1024

export function initVisualizer(context) {
  ctx = context
  canvas = ctx.els.canvas
  g = canvas.getContext('2d', { alpha: true })
  mode = ctx.state.visualizerMode || 'liquid'

  resize()
  window.addEventListener('resize', resize)
  initParticles()
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
  const energy = bassEnergy(freq)

  // Glow radial en el centro inferior
  const glow = g.createRadialGradient(width / 2, height * 1.05, 0, width / 2, height * 1.05, height * 0.9)
  glow.addColorStop(0, `rgba(40, 110, 235, ${0.18 + energy * 0.22})`)
  glow.addColorStop(1, 'rgba(40, 110, 235, 0)')
  g.fillStyle = glow
  g.fillRect(0, 0, width, height)

  const layers = [
    { amp: 26, speed: 0.020, freqX: 1.4, phase: 0.0, alpha: 0.10, base: 0.62 },
    { amp: 34, speed: 0.015, freqX: 1.9, phase: 1.1, alpha: 0.12, base: 0.68 },
    { amp: 22, speed: 0.026, freqX: 2.6, phase: 2.3, alpha: 0.14, base: 0.74 },
    { amp: 40, speed: 0.012, freqX: 1.1, phase: 3.4, alpha: 0.10, base: 0.80 },
    { amp: 18, speed: 0.032, freqX: 3.3, phase: 4.6, alpha: 0.16, base: 0.86 },
  ]

  layers.forEach((L, li) => {
    const boost = 1 + energy * 1.4
    const baseY = height * L.base
    g.beginPath()
    g.moveTo(0, height)
    for (let x = 0; x <= width; x += 6) {
      const nx = x / width
      const y =
        baseY -
        Math.sin(nx * Math.PI * L.freqX * 2 + t * L.speed + L.phase) * L.amp * boost -
        Math.sin(nx * Math.PI * L.freqX * 5 + t * L.speed * 1.7) * (L.amp * 0.25)
      g.lineTo(x, y)
    }
    g.lineTo(width, height)
    g.closePath()

    const grad = g.createLinearGradient(0, baseY - 60, 0, height)
    grad.addColorStop(0, `rgba(${20 + li * 12}, ${90 + li * 18}, 235, ${L.alpha + 0.04})`)
    grad.addColorStop(1, `rgba(20, 60, 200, 0)`)
    g.fillStyle = grad
    g.fill()

    // Cresta con highlight blanco-azul
    g.beginPath()
    for (let x = 0; x <= width; x += 6) {
      const nx = x / width
      const y =
        baseY -
        Math.sin(nx * Math.PI * L.freqX * 2 + t * L.speed + L.phase) * L.amp * boost -
        Math.sin(nx * Math.PI * L.freqX * 5 + t * L.speed * 1.7) * (L.amp * 0.25)
      if (x === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.strokeStyle = `rgba(150, 200, 255, ${0.10 + L.alpha})`
    g.lineWidth = 1.4
    g.shadowColor = 'rgba(120, 180, 255, 0.5)'
    g.shadowBlur = 8
    g.stroke()
    g.shadowBlur = 0
  })

  drawParticles(energy)
}

function initParticles() {
  particles = []
  for (let i = 0; i < 30; i++) particles.push(newParticle(true))
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
    const a = (0.2 + 0.5 * Math.abs(Math.sin(p.life))) * (0.5 + energy)
    g.beginPath()
    g.arc(px, py, p.r, 0, Math.PI * 2)
    g.fillStyle = `rgba(170, 210, 255, ${Math.min(0.7, a)})`
    g.shadowColor = 'rgba(120, 180, 255, 0.7)'
    g.shadowBlur = 6
    g.fill()
    g.shadowBlur = 0
  })
}

// ---------------------------------------------------------------------
// MODO 2 · ESPECTRO DE FRECUENCIAS
// ---------------------------------------------------------------------
function drawSpectrum() {
  const freq = getFrequency()
  const bars = 80
  const gap = 3
  const barW = (width - gap * (bars - 1)) / bars
  const mid = height * 0.62 // linea base (espacio para reflexion abajo)
  const step = Math.floor((freq.length * 0.7) / bars)

  for (let i = 0; i < bars; i++) {
    let v = 0
    for (let j = 0; j < step; j++) v += freq[i * step + j]
    v = v / step / 255 // 0..1
    v = Math.pow(v, 1.15)
    const h = v * mid * 0.92
    const x = i * (barW + gap)
    const top = mid - h

    // Caida suave de picos
    if (h > peaks[i]) peaks[i] = h
    else peaks[i] = Math.max(0, peaks[i] - 1.6)

    // Barra principal con gradiente vertical
    const grad = g.createLinearGradient(0, mid, 0, top)
    grad.addColorStop(0, 'rgba(22, 60, 165, 0.95)')
    grad.addColorStop(0.6, 'rgba(50, 120, 240, 0.95)')
    grad.addColorStop(1, 'rgba(130, 195, 255, 1)')
    g.fillStyle = grad
    if (h > mid * 0.6) {
      g.shadowColor = 'rgba(90, 170, 255, 0.7)'
      g.shadowBlur = 14
    }
    roundRectFill(x, top, barW, h, Math.min(barW / 2, 3))
    g.shadowBlur = 0

    // Indicador de pico
    g.fillStyle = 'rgba(200, 230, 255, 0.9)'
    g.fillRect(x, mid - peaks[i] - 2, barW, 2)

    // Reflexion espejada
    const refGrad = g.createLinearGradient(0, mid, 0, mid + h * 0.6)
    refGrad.addColorStop(0, 'rgba(60, 130, 240, 0.28)')
    refGrad.addColorStop(1, 'rgba(60, 130, 240, 0)')
    g.fillStyle = refGrad
    roundRectFill(x, mid + 2, barW, h * 0.6, Math.min(barW / 2, 3))
  }
}

// ---------------------------------------------------------------------
// MODO 3 · FORMA DE ONDA
// ---------------------------------------------------------------------
function drawWaveform() {
  const wave = getWave()
  const mid = height / 2

  // Tunel de luz muy sutil al fondo
  const tunnel = g.createRadialGradient(width / 2, mid, 10, width / 2, mid, width * 0.6)
  tunnel.addColorStop(0, 'rgba(30, 90, 210, 0.10)')
  tunnel.addColorStop(1, 'rgba(30, 90, 210, 0)')
  g.fillStyle = tunnel
  g.fillRect(0, 0, width, height)

  const layers = [
    { off: -10, w: 1, a: 0.25 },
    { off: 10, w: 1, a: 0.25 },
    { off: 0, w: 2.4, a: 0.95 }, // capa central mas gruesa con glow
  ]

  layers.forEach((L) => {
    g.beginPath()
    const slice = wave.length / width
    for (let x = 0; x <= width; x++) {
      const idx = Math.floor(x * slice)
      const v = (wave[idx] - 128) / 128
      const y = mid + L.off + v * (height * 0.32)
      if (x === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.strokeStyle =
      L.w > 2 ? 'rgba(150, 205, 255, 0.95)' : `rgba(90, 160, 255, ${L.a})`
    g.lineWidth = L.w
    if (L.w > 2) {
      g.shadowColor = 'rgba(80, 160, 255, 0.8)'
      g.shadowBlur = 12
    }
    g.stroke()
    g.shadowBlur = 0
  })
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
  const energy = bassEnergy(freq)
  const cx = width / 2
  const cy = height / 2

  // Nucleo brillante que late con el bass
  const coreR = 18 + energy * 60
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
