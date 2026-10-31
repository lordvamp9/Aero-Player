/* =====================================================================
   AERO PLAYER  ·  settings.js
   Panel de ajustes: cuentas, perfil, configuracion inicial y ecualizador.

   Ecualizador (modo dual):
     - Activo (checkbox ON): escribe el config.txt de Equalizer APO ->
       afecta TODO el audio del sistema (Spotify, YouTube, juegos, etc.)
       y tambien aplica los mismos filtros al grafo Web Audio local.
     - Inactivo (checkbox OFF): limpia EqAPO (Preamp 0 dB, sin filtros)
       y desconecta el grafo local. El audio vuelve a sonar plano.

   Presets:
     - Built-in (no se pueden borrar)
     - De usuario (se guardan con un nombre custom, persisten entre sesiones)
   ===================================================================== */

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
let userPresets = [] // [{ name, gains }]
let bandsEl, canvas, gctx, presetsEl
let dragBandIndex = -1
let eqapoAvailable = false
let eqApplyTimer = null

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

  // Temas de color
  initThemes()

  // Refresca el estado de cuentas cuando algo cambie en cualquier modulo
  ctx.on('youtube-auth', refreshAccounts)
  ctx.on('spotify-auth', refreshAccounts)
  ctx.on('profile-changed', refreshProfile)

  // Inicializa ecualizador (UI + EqAPO + persistencia)
  initEqUI()
  loadEqFromStore()
  detectEqApo()

  // Cleanup al cerrar la ventana: EqAPO en bypass para no dejar el sistema
  // procesando audio cuando Aero ya no esta corriendo (defensa redundante:
  // el lado Rust tambien lo limpia en CloseRequested).
  window.addEventListener('beforeunload', () => {
    if (ctx.aero && ctx.aero.eqapoClear) ctx.aero.eqapoClear().catch(() => {})
  })

  ctx.settings = { open, close }
}

function open() {
  overlay.hidden = false
  refreshProfile()
  refreshAccounts()
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
// Equalizer APO: deteccion + comunicacion
// ---------------------------------------------------------------------
async function detectEqApo() {
  try {
    if (!ctx.aero || !ctx.aero.eqapoStatus) return
    const r = await ctx.aero.eqapoStatus()
    eqapoAvailable = !!(r && r.installed)
    updateEqApoBanner()
    // Si estaba habilitado y EqAPO esta, aplicar las bandas guardadas; si no,
    // dejar el archivo en bypass por las dudas.
    if (eqapoAvailable) {
      if (eqEnabled) writeEqApoNow()
      else ctx.aero.eqapoClear().catch(() => {})
    }
  } catch {}
}

function updateEqApoBanner() {
  const banner = document.getElementById('eq-eqapo-status')
  if (!banner) return
  if (eqapoAvailable) {
    banner.textContent = 'EQ system-wide activo (Equalizer APO detectado)'
    banner.classList.remove('eq-warn')
    banner.classList.add('eq-ok')
  } else {
    banner.innerHTML = 'Equalizer APO no detectado. Solo se procesara audio local. <a href="#" id="eq-eqapo-link">Instalar</a>'
    banner.classList.remove('eq-ok')
    banner.classList.add('eq-warn')
    const a = document.getElementById('eq-eqapo-link')
    if (a) a.addEventListener('click', (e) => {
      e.preventDefault()
      if (ctx.aero && ctx.aero.openExternal) ctx.aero.openExternal('https://sourceforge.net/projects/equalizerapo/')
    })
  }
}

// Escribe el config.txt de EqAPO con un debounce corto para no spamear el disco
// mientras el usuario arrastra una banda. Solo escribe si el EQ esta habilitado.
function writeEqApoDebounced() {
  if (eqApplyTimer) clearTimeout(eqApplyTimer)
  eqApplyTimer = setTimeout(writeEqApoNow, 120)
}
function writeEqApoNow() {
  if (!eqapoAvailable || !ctx.aero || !ctx.aero.eqapoApply) return
  if (!eqEnabled) return
  // Preamp negativo proporcional al gain maximo para evitar clipping (heuristica
  // estandar en EQs digitales). Si la banda mas alta sube +X dB, preamp = -X/2.
  const maxGain = Math.max(0, ...eqGains.map((g) => Math.max(0, g)))
  const preamp = -Math.min(maxGain * 0.5, 6) // limite -6 dB
  ctx.aero.eqapoApply(gainsAsBands(), preamp).catch(() => {})
}

// ---------------------------------------------------------------------
// Ecualizador: UI
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
    // Web Audio local: prende o apaga el grafo.
    ctx.eq.setEnabled(eqEnabled, gainsAsBands())
    // Equalizer APO: aplica las bandas o pone en bypass.
    if (eqapoAvailable && ctx.aero) {
      if (eqEnabled) writeEqApoNow()
      else ctx.aero.eqapoClear().catch(() => {})
    }
    persistEq()
  })

  // Reset (Plano)
  document.getElementById('eq-reset').addEventListener('click', () => {
    applyPreset('Plano', null)
  })

  // Boton "Guardar como preset..."
  const btnSave = document.getElementById('eq-save-preset')
  if (btnSave) btnSave.addEventListener('click', saveCurrentAsPreset)

  renderPresets()

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

// Aplica al grafo Web Audio local Y a Equalizer APO (si esta habilitado).
function applyEqIfEnabled() {
  ctx.eq.apply(gainsAsBands())
  writeEqApoDebounced()
}

// preset: nombre del built-in o id del user preset. Si es null, no marca ninguno.
function applyPreset(name, userId) {
  let p = EQ_PRESETS[name]
  if (!p && userId != null) {
    const u = userPresets[userId]
    if (u) p = u.gains
  }
  if (!p) return
  eqGains = p.slice()
  syncAllBands()
  drawCurve()
  applyEqIfEnabled()
  persistEq()
  // Marca el preset activo en la UI
  presetsEl.querySelectorAll('.eq-preset').forEach((el) => {
    el.classList.toggle('active',
      (name && el.dataset.preset === name) ||
      (userId != null && el.dataset.userIdx === String(userId)))
  })
}

// ---------------------------------------------------------------------
// Drag de los sliders
// ---------------------------------------------------------------------
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
  // Escritura final inmediata cuando se suelta el slider (sin debounce).
  writeEqApoNow()
}

function setBandFromEvent(slider, e) {
  const r = slider.getBoundingClientRect()
  const frac = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
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

  const frac = (EQ_MAX - gain) / (EQ_MAX - EQ_MIN)
  const pct = frac * 100
  knob.style.top = pct + '%'
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

// ---------------------------------------------------------------------
// Sistema de presets de usuario
// ---------------------------------------------------------------------
function renderPresets() {
  presetsEl.innerHTML = ''
  // Built-in (no borrables)
  Object.keys(EQ_PRESETS).forEach((name) => {
    const b = document.createElement('button')
    b.className = 'eq-preset eq-preset-builtin'
    b.dataset.preset = name
    b.textContent = name
    b.addEventListener('click', () => applyPreset(name, null))
    presetsEl.appendChild(b)
  })
  // Separador
  if (userPresets.length) {
    const sep = document.createElement('span')
    sep.className = 'eq-preset-sep'
    sep.setAttribute('aria-hidden', 'true')
    presetsEl.appendChild(sep)
  }
  // De usuario (con boton borrar)
  userPresets.forEach((u, i) => {
    const wrap = document.createElement('span')
    wrap.className = 'eq-preset-wrap'
    wrap.innerHTML = `
      <button class="eq-preset eq-preset-user" data-user-idx="${i}" title="Aplicar preset">${escapeHtml(u.name)}</button>
      <button class="eq-preset-del" data-user-idx="${i}" title="Borrar preset">×</button>
    `
    wrap.querySelector('.eq-preset').addEventListener('click', () => applyPreset(null, i))
    wrap.querySelector('.eq-preset-del').addEventListener('click', (e) => {
      e.stopPropagation()
      deleteUserPreset(i)
    })
    presetsEl.appendChild(wrap)
  })
}

function saveCurrentAsPreset() {
  const defaultName = 'Mi preset ' + (userPresets.length + 1)
  const name = (prompt('Nombre del preset:', defaultName) || '').trim()
  if (!name) return
  // Si ya existe uno con ese nombre, lo sobrescribe (previa confirmacion)
  const existingIdx = userPresets.findIndex((p) => p.name.toLowerCase() === name.toLowerCase())
  if (existingIdx >= 0) {
    if (!confirm(`Ya existe un preset llamado "${name}". ¿Sobrescribirlo?`)) return
    userPresets[existingIdx] = { name, gains: eqGains.slice() }
  } else {
    userPresets.push({ name, gains: eqGains.slice() })
  }
  persistUserPresets()
  renderPresets()
  // Marca el recien creado como activo
  const idx = userPresets.findIndex((p) => p.name === name)
  if (idx >= 0) {
    presetsEl.querySelectorAll('.eq-preset').forEach((el) => {
      el.classList.toggle('active', el.dataset.userIdx === String(idx))
    })
  }
}

function deleteUserPreset(i) {
  if (!confirm(`Borrar el preset "${userPresets[i].name}"?`)) return
  userPresets.splice(i, 1)
  persistUserPresets()
  renderPresets()
}

function persistUserPresets() {
  ctx.aero.storeSet('eqUserPresets', userPresets)
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------
// Canvas con la curva al estilo FXSound
// ---------------------------------------------------------------------
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

  gctx.strokeStyle = 'rgba(120, 175, 255, 0.18)'
  gctx.setLineDash([3, 4])
  gctx.lineWidth = 1
  gctx.beginPath()
  gctx.moveTo(0, h / 2)
  gctx.lineTo(w, h / 2)
  gctx.stroke()
  gctx.setLineDash([])

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

  const points = []
  for (let i = 0; i < n; i++) {
    const x = slotW * (i + 0.5)
    const y = h / 2 - (eqGains[i] / EQ_MAX) * (h / 2 - 8)
    points.push({ x, y })
  }

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

// ---------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------
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

    // Presets de usuario
    const up = await ctx.aero.storeGet('eqUserPresets')
    if (Array.isArray(up)) {
      userPresets = up.filter((p) => p && typeof p.name === 'string' && Array.isArray(p.gains))
      renderPresets()
    }
  } catch {
    /* primera ejecucion */
  }
}

function persistEq() {
  ctx.aero.storeSet('eq', { enabled: eqEnabled, gains: eqGains })
}

// ---------------------------------------------------------------------
// Temas de color (original / rosa pastel / oscuro)
// El tema se aplica via data-theme en <html>. Un script en linea del <head>
// ya lo fija al arrancar desde localStorage (sin parpadeo); aqui solo se
// gestiona el cambio desde el panel de Ajustes.
// ---------------------------------------------------------------------
const THEMES = ['original', 'pink', 'dark']

function initThemes() {
  const wrap = document.getElementById('theme-options')
  if (!wrap) return
  const current = document.documentElement.getAttribute('data-theme') || 'original'
  highlightTheme(current)
  wrap.querySelectorAll('.theme-opt').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme))
  })
}

function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'original'
  if (name === 'original') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', name)
  try { localStorage.setItem('aero-theme', name) } catch {}
  try { ctx.aero.storeSet('theme', name) } catch {}
  highlightTheme(name)
}

function highlightTheme(name) {
  const wrap = document.getElementById('theme-options')
  if (!wrap) return
  wrap.querySelectorAll('.theme-opt').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === name)
  })
}
