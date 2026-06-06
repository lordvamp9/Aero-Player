/* =====================================================================
   AERO PLAYER  ·  settings.js
   Panel de ajustes: gestion de sesiones, ecualizador editable estilo
   FXSound y disparador del editor de perfil.
   ===================================================================== */

// Bandas del ecualizador (mismas frecuencias que muestra la referencia)
export const EQ_FREQS = [30, 81, 150, 290, 542, 1000, 2000, 4000, 8000, 16000]
export const EQ_MIN = -12
export const EQ_MAX = 12

const EQ_PRESETS = {
  Plano: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Graves: [6, 5, 4, 2, 0, 0, -1, -1, 0, 1],
  Vocal: [-2, -1, 0, 2, 3, 4, 3, 2, 1, 0],
  Electronica: [5, 4, 2, 0, -2, 0, 2, 4, 5, 6],
  Acustica: [3, 2, 1, 0, 1, 1, 2, 3, 3, 2],
}

let ctx
let panel, overlay
let eqEnabled = false
let eqGains = EQ_PRESETS.Plano.slice()
let bandsEl, canvas, gctx, presetsEl
let dragBandIndex = -1

export function initSettings(context) {
  ctx = context
  overlay = document.getElementById('settings-overlay')
  panel = document.getElementById('settings-panel')

  // Apertura / cierre
  document.getElementById('btn-settings').addEventListener('click', open)
  document.getElementById('settings-close').addEventListener('click', close)
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close()
  })

  // Cerrar sesiones
  document.getElementById('btn-logout-yt').addEventListener('click', async () => {
    if (!ctx.state.auth.google.connected) return
    await ctx.youtube.logout()
    refreshAccounts()
  })
  document.getElementById('btn-logout-sp').addEventListener('click', async () => {
    if (!ctx.state.auth.spotify.connected) return
    await ctx.spotify.logout()
    refreshAccounts()
  })

  // Editor de perfil
  document.getElementById('btn-edit-profile').addEventListener('click', () => {
    close()
    ctx.profile.openEditor()
  })

  // Configuracion inicial (wizard de credenciales OAuth)
  const btnSetup = document.getElementById('btn-open-setup')
  if (btnSetup) btnSetup.addEventListener('click', () => {
    close()
    if (typeof ctx.openSetup === 'function') ctx.openSetup()
  })

  // Refresca el estado de cuentas cuando algo cambie en cualquier modulo
  ctx.on('youtube-auth', refreshAccounts)
  ctx.on('spotify-auth', refreshAccounts)
  ctx.on('profile-changed', refreshProfile)

  // Inicializa ecualizador
  initEqUI()
  loadEqFromStore()

  ctx.settings = { open, close }
}

function open() {
  overlay.hidden = false
  refreshProfile()
  refreshAccounts()
  // Redibuja el canvas (puede haber sido oculto antes con tamaño 0)
  requestAnimationFrame(resizeCanvas)
}

function close() {
  overlay.classList.add('leaving')
  setTimeout(() => {
    overlay.hidden = true
    overlay.classList.remove('leaving')
  }, 180)
}

// ---------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------
function refreshProfile() {
  const p = ctx.profile?.get?.() || { name: 'Invitado', avatar: null }
  document.getElementById('settings-profile-name').textContent = p.name || 'Invitado'
  const av = document.getElementById('settings-profile-avatar')
  av.style.backgroundImage = p.avatar ? `url("${p.avatar}")` : ''
}

// ---------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------
function refreshAccounts() {
  const yt = ctx.state.auth.google.connected
  const sp = ctx.state.auth.spotify.connected
  const ytBtn = document.getElementById('btn-logout-yt')
  const spBtn = document.getElementById('btn-logout-sp')
  document.getElementById('settings-yt-state').textContent = yt ? '· conectado' : '· no conectado'
  document.getElementById('settings-sp-state').textContent = sp ? '· conectado' : '· no conectado'
  ytBtn.disabled = !yt
  spBtn.disabled = !sp
}

// ---------------------------------------------------------------------
// Ecualizador
// ---------------------------------------------------------------------
function initEqUI() {
  bandsEl = document.getElementById('eq-bands')
  canvas = document.getElementById('eq-canvas')
  gctx = canvas.getContext('2d')
  presetsEl = document.getElementById('eq-presets')

  // Sliders verticales
  EQ_FREQS.forEach((freq, i) => {
    const band = document.createElement('div')
    band.className = 'eq-band'
    band.innerHTML = `
      <span class="eq-band-value" data-i="${i}">+0</span>
      <div class="eq-band-slider" data-i="${i}">
        <div class="eq-band-fill" data-i="${i}"></div>
        <div class="eq-band-knob" data-i="${i}"></div>
      </div>
      <span class="eq-band-label">${formatFreq(freq)}</span>
    `
    bandsEl.appendChild(band)
  })
  bandsEl.addEventListener('mousedown', onBandMouseDown)
  window.addEventListener('mouseup', onBandMouseUp)
  window.addEventListener('mousemove', onBandMouseMove)

  // Doble click: vuelve a 0 dB esa banda
  bandsEl.addEventListener('dblclick', (e) => {
    const slider = e.target.closest('.eq-band-slider')
    if (!slider) return
    const i = Number(slider.dataset.i)
    eqGains[i] = 0
    syncBand(i)
    applyEqIfEnabled()
    persistEq()
    drawCurve()
  })

  // Toggle on/off
  const enableEl = document.getElementById('eq-enabled')
  enableEl.addEventListener('change', () => {
    eqEnabled = enableEl.checked
    document.querySelector('.settings-section:nth-child(3)')?.classList.toggle('eq-disabled', !eqEnabled)
    ctx.eq.setEnabled(eqEnabled, gainsAsBands())
    persistEq()
  })

  // Reset
  document.getElementById('eq-reset').addEventListener('click', () => {
    applyPreset('Plano')
  })

  // Presets
  Object.keys(EQ_PRESETS).forEach((name) => {
    const b = document.createElement('button')
    b.className = 'eq-preset'
    b.dataset.preset = name
    b.textContent = name
    b.addEventListener('click', () => applyPreset(name))
    presetsEl.appendChild(b)
  })

  window.addEventListener('resize', resizeCanvas)
  resizeCanvas()
  syncAllBands()
}

function formatFreq(f) {
  if (f >= 1000) return (f / 1000).toFixed(f % 1000 === 0 ? 0 : 1) + 'k'
  return f + ''
}

function gainsAsBands() {
  return EQ_FREQS.map((freq, i) => ({ freq, gain: eqGains[i] }))
}

function applyEqIfEnabled() {
  if (eqEnabled) ctx.eq.apply(gainsAsBands())
  else ctx.eq.apply(gainsAsBands()) // guarda lastBands sin aplicar
}

function applyPreset(name) {
  const p = EQ_PRESETS[name]
  if (!p) return
  eqGains = p.slice()
  syncAllBands()
  drawCurve()
  applyEqIfEnabled()
  persistEq()
  presetsEl.querySelectorAll('.eq-preset').forEach((el) => {
    el.classList.toggle('active', el.dataset.preset === name)
  })
}

// --- Drag de los sliders ---------------------------------------------------
function onBandMouseDown(e) {
  const slider = e.target.closest('.eq-band-slider')
  if (!slider) return
  dragBandIndex = Number(slider.dataset.i)
  slider.classList.add('active')
  setBandFromEvent(slider, e)
  e.preventDefault()
}
function onBandMouseMove(e) {
  if (dragBandIndex < 0) return
  const slider = bandsEl.querySelector(`.eq-band-slider[data-i="${dragBandIndex}"]`)
  if (slider) setBandFromEvent(slider, e)
}
function onBandMouseUp() {
  if (dragBandIndex < 0) return
  bandsEl.querySelectorAll('.eq-band-slider').forEach((s) => s.classList.remove('active'))
  dragBandIndex = -1
  persistEq()
}

function setBandFromEvent(slider, e) {
  const r = slider.getBoundingClientRect()
  const frac = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
  // top => +EQ_MAX, bottom => EQ_MIN
  const gain = EQ_MAX - frac * (EQ_MAX - EQ_MIN)
  const i = Number(slider.dataset.i)
  eqGains[i] = Math.round(gain * 10) / 10
  syncBand(i)
  applyEqIfEnabled()
  drawCurve()
  clearPresetSelection()
}

function clearPresetSelection() {
  presetsEl.querySelectorAll('.eq-preset').forEach((el) => el.classList.remove('active'))
}

function syncBand(i) {
  const gain = eqGains[i]
  const slider = bandsEl.querySelector(`.eq-band-slider[data-i="${i}"]`)
  const fill = bandsEl.querySelector(`.eq-band-fill[data-i="${i}"]`)
  const knob = bandsEl.querySelector(`.eq-band-knob[data-i="${i}"]`)
  const valEl = bandsEl.querySelector(`.eq-band-value[data-i="${i}"]`)
  if (!slider) return

  // Mapeo gain -> fraccion vertical (0 top, 1 bottom)
  const frac = (EQ_MAX - gain) / (EQ_MAX - EQ_MIN)
  const pct = frac * 100
  knob.style.top = pct + '%'
  // El relleno crece desde la posicion del knob hasta la linea de 0 dB
  if (gain >= 0) {
    fill.style.top = pct + '%'
    fill.style.bottom = '50%'
  } else {
    fill.style.top = '50%'
    fill.style.bottom = 100 - pct + '%'
  }
  const sign = gain > 0 ? '+' : ''
  valEl.textContent = sign + (Number.isInteger(gain) ? gain.toFixed(0) : gain.toFixed(1))
}

function syncAllBands() {
  for (let i = 0; i < EQ_FREQS.length; i++) syncBand(i)
}

// --- Canvas con la curva al estilo FXSound ---------------------------------
function resizeCanvas() {
  if (!canvas) return
  const r = canvas.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.max(1, Math.floor(r.width * dpr))
  canvas.height = Math.max(1, Math.floor(r.height * dpr))
  gctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  drawCurve()
}

function drawCurve() {
  if (!canvas) return
  const r = canvas.getBoundingClientRect()
  const w = r.width
  const h = r.height
  gctx.clearRect(0, 0, w, h)

  // Linea horizontal de 0 dB
  gctx.strokeStyle = 'rgba(120, 175, 255, 0.18)'
  gctx.setLineDash([3, 4])
  gctx.lineWidth = 1
  gctx.beginPath()
  gctx.moveTo(0, h / 2)
  gctx.lineTo(w, h / 2)
  gctx.stroke()
  gctx.setLineDash([])

  // Lineas verticales en cada banda
  gctx.strokeStyle = 'rgba(120, 175, 255, 0.1)'
  const n = EQ_FREQS.length
  const slotW = w / n
  for (let i = 0; i < n; i++) {
    const x = slotW * (i + 0.5)
    gctx.beginPath()
    gctx.moveTo(x, 6)
    gctx.lineTo(x, h - 6)
    gctx.stroke()
  }

  // Puntos de cada banda
  const points = []
  for (let i = 0; i < n; i++) {
    const x = slotW * (i + 0.5)
    const y = h / 2 - (eqGains[i] / EQ_MAX) * (h / 2 - 8)
    points.push({ x, y })
  }

  // Curva suave (Catmull-Rom -> Bezier)
  gctx.strokeStyle = 'rgba(110, 180, 255, 0.95)'
  gctx.lineWidth = 1.8
  gctx.shadowColor = 'rgba(80, 160, 255, 0.55)'
  gctx.shadowBlur = 8
  gctx.beginPath()
  gctx.moveTo(points[0].x, points[0].y)
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    gctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y)
  }
  gctx.stroke()
  gctx.shadowBlur = 0

  // Nodos de cada banda
  points.forEach((p, i) => {
    const gain = eqGains[i]
    gctx.beginPath()
    gctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2)
    gctx.fillStyle = gain === 0 ? 'rgba(170, 210, 255, 0.85)' : 'rgba(190, 225, 255, 1)'
    gctx.shadowColor = 'rgba(80, 160, 255, 0.7)'
    gctx.shadowBlur = gain === 0 ? 0 : 8
    gctx.fill()
    gctx.shadowBlur = 0
  })

  // Etiquetas de dB en cada nodo
  gctx.font = '10px "Segoe UI", system-ui, sans-serif'
  gctx.fillStyle = 'rgba(190, 220, 255, 0.85)'
  gctx.textAlign = 'center'
  points.forEach((p, i) => {
    const gain = eqGains[i]
    const sign = gain > 0 ? '+' : ''
    const label = sign + (Number.isInteger(gain) ? gain.toFixed(0) : gain.toFixed(1))
    const yLabel = gain >= 0 ? p.y - 8 : p.y + 14
    gctx.fillText(label, p.x, yLabel)
  })
}

// --- Persistencia ----------------------------------------------------------
async function loadEqFromStore() {
  try {
    const saved = await ctx.aero.storeGet('eq')
    if (saved && Array.isArray(saved.gains) && saved.gains.length === EQ_FREQS.length) {
      eqGains = saved.gains.slice()
    }
    eqEnabled = !!(saved && saved.enabled)
    document.getElementById('eq-enabled').checked = eqEnabled
    document.querySelector('.settings-section:nth-child(3)')?.classList.toggle('eq-disabled', !eqEnabled)
    syncAllBands()
    drawCurve()
    ctx.eq.setEnabled(eqEnabled, gainsAsBands())
  } catch {
    /* primera ejecucion */
  }
}

function persistEq() {
  ctx.aero.storeSet('eq', { enabled: eqEnabled, gains: eqGains })
}
