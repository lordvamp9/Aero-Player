/* =====================================================================
   AERO PLAYER  ·  sidebar.js
   Navegacion entre secciones, gestion de estado de los items y conexion
   visual con la autenticacion de YouTube y Spotify.
   ===================================================================== */

export function initSidebar(ctx) {
  // --- Navegacion de la biblioteca local ---
  document.querySelectorAll('.src-item[data-local]').forEach((item) => {
    item.addEventListener('click', () => {
      setActive(item)
      ctx.library.renderView(item.dataset.local)
    })
  })

  // --- Boton agregar carpeta ---
  document.getElementById('btn-add-folder').addEventListener('click', () => ctx.library.addFolder())

  // --- Botones de conexion ---
  document.getElementById('btn-connect-yt').addEventListener('click', () => {
    if (ctx.state.auth.google.connected) ctx.youtube.logout()
    else ctx.youtube.connect()
  })
  document.getElementById('btn-connect-sp').addEventListener('click', () => {
    if (ctx.state.auth.spotify.connected) ctx.spotify.logout()
    else ctx.spotify.connect()
  })

  // --- Items de YouTube / Spotify ---
  document.querySelectorAll('.src-item[data-yt]').forEach((item) => {
    item.addEventListener('click', () => {
      setActive(item)
      ctx.youtube.loadSection(item.dataset.yt)
    })
  })
  document.querySelectorAll('.src-item[data-sp]').forEach((item) => {
    item.addEventListener('click', () => {
      setActive(item)
      ctx.spotify.loadSection(item.dataset.sp)
    })
  })

  // --- Reaccion a cambios de autenticacion ---
  ctx.on('youtube-auth', (info) => updateAuthSection(ctx, 'youtube', info))
  ctx.on('spotify-auth', (info) => updateAuthSection(ctx, 'spotify', info))

  // --- Estado inicial de autenticacion ---
  refreshAuthStatus(ctx)

  function setActive(el) {
    document.querySelectorAll('.src-item').forEach((i) => i.classList.remove('active'))
    el.classList.add('active')
  }
}

async function refreshAuthStatus(ctx) {
  try {
    const status = await ctx.aero.getAuthStatus()
    if (status.google) {
      ctx.state.auth.google = status.google
      updateAuthSection(ctx, 'youtube', status.google)
    }
    if (status.spotify) {
      ctx.state.auth.spotify = status.spotify
      updateAuthSection(ctx, 'spotify', status.spotify)
    }
  } catch {
    /* sin sesion previa */
  }
}

function updateAuthSection(ctx, platform, info) {
  const isYt = platform === 'youtube'
  const btn = document.getElementById(isYt ? 'btn-connect-yt' : 'btn-connect-sp')
  const list = document.getElementById(isYt ? 'yt-list' : 'sp-list')
  const dot = document.getElementById(isYt ? 'yt-status-dot' : 'sp-status-dot')
  const label = btn.querySelector('span')

  if (info && info.connected) {
    btn.classList.add('connected')
    label.textContent = `Conectado: ${info.userName || (isYt ? 'YouTube' : 'Spotify')}`
    list.hidden = false
    dot.classList.add('online')
    if (isYt) dot.classList.add('yt')
  } else {
    btn.classList.remove('connected')
    label.textContent = isYt ? 'Conectar YouTube' : 'Conectar Spotify'
    list.hidden = true
    dot.classList.remove('online', 'yt')
  }
}
