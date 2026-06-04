/* =====================================================================
   AERO PLAYER  ·  profile.js
   Perfil nativo del usuario (nombre + foto). En el primer arranque se
   muestra una tarjeta de bienvenida modal que bloquea el resto de la UI
   hasta que el usuario complete los datos. Despues queda accesible desde
   el panel de Ajustes para modificarlo cuando quiera.
   ===================================================================== */

const DEFAULT_AVATAR_GRADIENT = null // null = se renderiza el gradiente CSS

let ctx
let overlay, card, title
let avatarPickBtn, avatarPreview, nameInput
let btnSave, btnCancel, btnClose
let profile = { name: '', avatar: null, createdAt: null }
let isWelcome = false

export async function initProfile(context) {
  ctx = context
  overlay = document.getElementById('profile-overlay')
  card = overlay.querySelector('.profile-card')
  title = document.getElementById('profile-card-title')
  avatarPickBtn = document.getElementById('profile-avatar-pick')
  avatarPreview = document.getElementById('profile-avatar-preview')
  nameInput = document.getElementById('profile-name-input')
  btnSave = document.getElementById('profile-save')
  btnCancel = document.getElementById('profile-cancel')
  btnClose = document.getElementById('profile-close')

  avatarPickBtn.addEventListener('click', pickAvatar)
  btnSave.addEventListener('click', save)
  btnCancel.addEventListener('click', closeEditor)
  btnClose.addEventListener('click', closeEditor)
  nameInput.addEventListener('input', updateSaveState)
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !btnSave.disabled) save()
    if (e.key === 'Escape' && !isWelcome) closeEditor()
  })

  ctx.profile = {
    get: () => ({ ...profile }),
    openEditor,
  }

  // Atajo: clic sobre el chip de la titlebar abre el editor.
  const chip = document.getElementById('titlebar-profile')
  if (chip) chip.addEventListener('click', openEditor)

  await load()
  refreshHeader()

  // Si no hay perfil guardado, dispara la bienvenida una sola vez.
  if (!profile.createdAt) openWelcome()
}

async function load() {
  try {
    const saved = await ctx.aero.storeGet('profile')
    if (saved && typeof saved === 'object') {
      profile = {
        name: saved.name || '',
        avatar: saved.avatar || null,
        createdAt: saved.createdAt || null,
      }
    }
  } catch {
    /* ignore */
  }
}

function refreshHeader() {
  const tpName = document.getElementById('tp-name')
  const tpAvatar = document.getElementById('tp-avatar')
  if (tpName) tpName.textContent = profile.name || 'Invitado'
  if (tpAvatar) tpAvatar.style.backgroundImage = profile.avatar ? `url("${profile.avatar}")` : ''
}

function openWelcome() {
  isWelcome = true
  overlay.classList.add('is-welcome')
  title.textContent = 'Bienvenido a Aero Player'
  ensureGreeting(
    'Antes de empezar contanos como te llamamos y, si quieres, elige una foto. Podras cambiarlo cuando gustes desde Ajustes.'
  )
  nameInput.value = ''
  setPreview(null)
  overlay.hidden = false
  updateSaveState()
  setTimeout(() => nameInput.focus(), 80)
}

function openEditor() {
  isWelcome = false
  overlay.classList.remove('is-welcome')
  title.textContent = 'Editar perfil'
  removeGreeting()
  nameInput.value = profile.name || ''
  setPreview(profile.avatar)
  overlay.hidden = false
  updateSaveState()
  setTimeout(() => nameInput.focus(), 80)
}

function closeEditor() {
  if (isWelcome) return // la bienvenida no se puede cerrar sin guardar
  overlay.classList.add('leaving')
  setTimeout(() => {
    overlay.hidden = true
    overlay.classList.remove('leaving')
  }, 180)
}

async function pickAvatar() {
  try {
    const res = await ctx.aero.openImageDialog()
    if (res && !res.canceled && res.base64) {
      setPreview(res.base64)
    }
  } catch (err) {
    ctx.toast && ctx.toast('No se pudo abrir el selector de imagen.')
  }
}

function setPreview(dataUrl) {
  avatarPreview.style.backgroundImage = dataUrl ? `url("${dataUrl}")` : ''
  avatarPreview.dataset.value = dataUrl || ''
}

function updateSaveState() {
  const name = nameInput.value.trim()
  btnSave.disabled = name.length < 1
}

async function save() {
  const name = nameInput.value.trim()
  if (!name) return
  const avatar = avatarPreview.dataset.value || profile.avatar || null

  profile = {
    name,
    avatar,
    createdAt: profile.createdAt || Date.now(),
  }
  await ctx.aero.storeSet('profile', profile)

  refreshHeader()

  if (isWelcome) {
    // Cierra la bienvenida con animacion y desbloquea la app.
    isWelcome = false
    overlay.classList.remove('is-welcome')
    overlay.classList.add('leaving')
    setTimeout(() => {
      overlay.hidden = true
      overlay.classList.remove('leaving')
      ctx.toast && ctx.toast(`Hola, ${profile.name}. Aero Player listo.`)
    }, 240)
  } else {
    closeEditor()
    ctx.toast && ctx.toast('Perfil actualizado.')
  }

  ctx.emit && ctx.emit('profile-changed', profile)
}

// --- Saludo extra solo en modo bienvenida ----------------------------------
function ensureGreeting(text) {
  let el = overlay.querySelector('.profile-welcome-greeting')
  if (!el) {
    el = document.createElement('p')
    el.className = 'profile-welcome-greeting'
    const body = overlay.querySelector('.profile-body')
    body.parentNode.insertBefore(el, body)
  }
  el.textContent = text
  el.hidden = false
}
function removeGreeting() {
  const el = overlay.querySelector('.profile-welcome-greeting')
  if (el) el.hidden = true
}
