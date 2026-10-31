/* =====================================================================
   AERO PLAYER  ·  playlists.js
   Sistema completo de playlists propias del usuario.
   - Carga/persistencia en plugin-store de Tauri via window.aero
   - Render del listado en el sidebar (Mis playlists)
   - Vista de contenido (header + lista con drag and drop)
   - Modal glass de creacion / edicion de portada
   - Menus contextuales (crear, editar, eliminar, importar, agregar pista)
   - Importacion en bulk desde playlists de Spotify y YouTube
   ===================================================================== */

import { escapeHtml, formatTime, platformIcon, ytIcon, spIcon, localIcon } from './app.js'

let ctx
let playlists = []
let currentPlaylistId = null

export function initPlaylists(context) {
  ctx = context

  ctx.playlists = {
    load,
    getAll: () => playlists,
    findById: (id) => playlists.find((p) => p.id === id),
    showMyPlaylistsInSidebar,
    showPlaylistView,
    showCreateModal,
    addTrackToPlaylist,
    showAddToPlaylistSubmenuItems,
    importFromExternalPlaylist,
  }

  // Menu contextual del area de "Mis playlists" (espacio vacio).
  const myList = document.getElementById('my-playlists')
  const myEmpty = document.getElementById('my-playlists-empty')

  myList.addEventListener('contextmenu', (e) => {
    // Solo si el click no es sobre un item existente.
    if (e.target.closest('.my-playlist-item')) return
    e.preventDefault()
    showEmptyAreaMenu(e.clientX, e.clientY)
  })
  myEmpty.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    showEmptyAreaMenu(e.clientX, e.clientY)
  })

  load()
}

// ---------------------------------------------------------------------
// Carga / persistencia
// ---------------------------------------------------------------------
async function load() {
  try {
    playlists = (await ctx.aero.playlistsGetAll()) || []
  } catch {
    playlists = []
  }
  renderSidebarList()
}

async function showMyPlaylistsInSidebar() {
  await load()
  document.getElementById('my-playlists').hidden = playlists.length === 0
  document.getElementById('my-playlists-empty').hidden = playlists.length > 0
  // Cierra la vista de listas si estaba abierta.
  ctx.els.listView.hidden = true
  ctx.els.nowPlaying.style.opacity = '1'
}

function renderSidebarList() {
  const ul = document.getElementById('my-playlists')
  const empty = document.getElementById('my-playlists-empty')
  ul.innerHTML = ''

  if (!playlists.length) {
    ul.hidden = true
    // Solo mostrar el mensaje vacio si la seccion "Mis playlists" esta activa.
    const active = document.querySelector('.src-item[data-section="playlists"].active')
    empty.hidden = !active
    return
  }
  empty.hidden = true
  ul.hidden = false

  playlists.forEach((pl) => {
    const li = document.createElement('li')
    li.className = 'my-playlist-item'
    li.dataset.id = pl.id
    if (pl.id === currentPlaylistId) li.classList.add('active')
    li.innerHTML = playlistThumbHtml(pl) + `
      <div class="mp-text">
        <span class="mp-name">${escapeHtml(pl.name)}</span>
        <span class="mp-count">${pl.tracks.length} ${pl.tracks.length === 1 ? 'cancion' : 'canciones'}</span>
      </div>
    `
    li.addEventListener('click', () => showPlaylistView(pl.id))
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      showPlaylistContextMenu(e.clientX, e.clientY, pl)
    })
    ul.appendChild(li)
  })
}

function playlistThumbHtml(pl, withClass = 'mp-thumb') {
  const cover = pl.coverBase64 || pl.coverPath
  if (cover) {
    return `<span class="${withClass}" style="background-image:url('${cover}')"></span>`
  }
  return `<span class="${withClass} placeholder">${musicNoteIcon(13)}</span>`
}

function musicNoteIcon(size = 13) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>`
}

// ---------------------------------------------------------------------
// Vista de contenido de una playlist
// ---------------------------------------------------------------------
function showPlaylistView(playlistId) {
  const pl = playlists.find((p) => p.id === playlistId)
  if (!pl) return
  currentPlaylistId = playlistId
  renderSidebarList()

  ctx.els.listViewTitle.textContent = ''
  ctx.els.listViewCount.textContent = ''
  ctx.els.listViewBody.innerHTML = ''

  const wrap = document.createElement('div')
  wrap.className = 'playlist-view'
  wrap.appendChild(renderPlaylistHeader(pl))
  wrap.appendChild(renderPlaylistTracks(pl))
  ctx.els.listViewBody.appendChild(wrap)
  // Oculta el encabezado generico para no duplicar titulo.
  ctx.els.listView.querySelector('.list-view-head').style.display = 'none'
  ctx.els.listView.hidden = false
  ctx.els.nowPlaying.style.opacity = '0.15'
}

function renderPlaylistHeader(pl) {
  const header = document.createElement('div')
  header.className = 'playlist-header'

  const cover = document.createElement('div')
  const coverImg = pl.coverBase64 || pl.coverPath
  cover.className = 'playlist-cover-lg' + (coverImg ? '' : ' placeholder')
  if (coverImg) cover.style.backgroundImage = `url('${coverImg}')`
  else cover.innerHTML = `<span class="placeholder-glyph">${musicNoteIcon(46)}</span>`

  const totalSec = pl.tracks.reduce((a, t) => a + (t.duration || 0), 0)
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const durLabel = hours > 0 ? `${hours} h ${mins} min` : `${mins} min`

  const meta = document.createElement('div')
  meta.className = 'playlist-meta'
  meta.innerHTML = `
    <span class="playlist-label">Playlist</span>
    <h1 class="playlist-name">${escapeHtml(pl.name)}</h1>
    <span class="playlist-sub">${pl.tracks.length} ${pl.tracks.length === 1 ? 'cancion' : 'canciones'} &middot; ${durLabel}</span>
    <div class="playlist-actions">
      <button class="pl-btn" data-act="play">
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
        <span>Reproducir todo</span>
      </button>
      <button class="pl-btn secondary" data-act="queue">
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 6h12M4 12h12M4 18h8M18 14l4 4-4 4"/></svg>
        <span>Agregar a la cola</span>
      </button>
    </div>
  `

  meta.querySelector('[data-act="play"]').addEventListener('click', () => playAll(pl))
  meta.querySelector('[data-act="queue"]').addEventListener('click', () => addAllToQueue(pl))

  header.appendChild(cover)
  header.appendChild(meta)
  return header
}

function renderPlaylistTracks(pl) {
  const list = document.createElement('div')
  list.className = 'pl-tracks'

  if (!pl.tracks.length) {
    const empty = document.createElement('div')
    empty.className = 'list-empty'
    empty.innerHTML = 'Esta playlist esta vacia.<br>Agrega canciones con click derecho sobre cualquier pista.'
    list.appendChild(empty)
    return list
  }

  pl.tracks.forEach((track, i) => {
    const row = document.createElement('div')
    row.className = 'pl-row'
    row.dataset.id = track.id
    row.dataset.index = i
    row.draggable = true
    if (track.id === ctx.state.currentId) row.classList.add('active')

    const cover = track.coverUrl ? `background-image:url('${track.coverUrl}')` : ''
    row.innerHTML = `
      <div class="pl-num">
        <span class="pl-num-text">${i + 1}</span>
        <span class="pl-num-play"><svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M8 5v14l11-7z"/></svg></span>
      </div>
      <span class="pl-platform">${platformIcon(track.source, 14)}</span>
      <span class="pl-cover" style="${cover}"></span>
      <div class="pl-main">
        <span class="pl-title">${escapeHtml(track.title)}</span>
        <span class="pl-sub">${escapeHtml(track.artist)}${track.album ? ' &middot; ' + escapeHtml(track.album) : ''}</span>
      </div>
      <span class="pl-dur">${track.durationFormatted || formatTime(track.duration)}</span>
    `

    row.addEventListener('click', () => {
      ctx.player.playItem(track, { list: pl.tracks, index: i })
    })

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      ctx.contextMenu.show(e.clientX, e.clientY, [
        { label: 'Reproducir ahora', action: () => ctx.player.playItem(track, { list: pl.tracks, index: i }) },
        { label: 'Agregar a la cola', action: () => ctx.queue.add({ ...track }) },
        { sep: true },
        { label: 'Mover al inicio', action: () => moveTrackEdge(pl.id, track.id, 'top') },
        { label: 'Mover al final', action: () => moveTrackEdge(pl.id, track.id, 'bottom') },
        { sep: true },
        { label: 'Eliminar de esta playlist', action: () => removeTrack(pl.id, track.id) },
      ])
    })

    // Drag and drop interno.
    row.addEventListener('dragstart', (e) => {
      row.classList.add('dragging')
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/x-pl-row', String(i))
    })
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging')
      list.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'))
    })
    row.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/x-pl-row')) return
      e.preventDefault()
      list.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'))
      row.classList.add('drag-over')
    })
    row.addEventListener('drop', async (e) => {
      e.preventDefault()
      const from = Number(e.dataTransfer.getData('text/x-pl-row'))
      const to = Number(row.dataset.index)
      if (!isNaN(from) && from !== to) {
        await reorderTrack(pl.id, from, to)
      }
      row.classList.remove('drag-over')
    })

    list.appendChild(row)
  })

  return list
}

async function playAll(pl) {
  if (!pl.tracks.length) return
  ctx.player.playItem(pl.tracks[0], { list: pl.tracks, index: 0 })
}

function addAllToQueue(pl) {
  if (!pl.tracks.length) return
  pl.tracks.forEach((t) => ctx.state.queue.push({ ...t, id: 'qm-' + Math.random().toString(36).slice(2) }))
  ctx.emit('queue-changed')
  ctx.updateStatusBar()
  ctx.toast(`${pl.tracks.length} canciones agregadas a la cola`)
}

// ---------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------
async function createPlaylist({ name, coverPath = null, coverBase64 = null }) {
  const res = await ctx.aero.playlistsCreate({ name, coverPath, coverBase64 })
  if (!res.ok) {
    ctx.toast(res.error || 'No se pudo crear la playlist.')
    return null
  }
  await load()
  return res.playlist
}

async function renamePlaylist(id, name) {
  const res = await ctx.aero.playlistsUpdate(id, { name })
  if (res.ok) await load()
  return res.ok
}

async function changeCover(id) {
  const res = await ctx.aero.openImageDialog()
  if (res.canceled) return
  await ctx.aero.playlistsUpdate(id, { coverPath: res.path, coverBase64: res.base64 })
  await load()
  if (id === currentPlaylistId) showPlaylistView(id)
  ctx.toast('Portada actualizada')
}

async function deletePlaylist(id) {
  const pl = playlists.find((p) => p.id === id)
  if (!pl) return
  showConfirmModal({
    title: 'Eliminar playlist',
    message: `¿Eliminar "${pl.name}"? Esta accion no se puede deshacer.`,
    confirmLabel: 'Eliminar',
    danger: true,
    onConfirm: async () => {
      await ctx.aero.playlistsDelete(id)
      if (currentPlaylistId === id) {
        currentPlaylistId = null
        ctx.els.listView.hidden = true
        ctx.els.nowPlaying.style.opacity = '1'
        ctx.els.listView.querySelector('.list-view-head').style.display = ''
      }
      await load()
      ctx.toast('Playlist eliminada')
    },
  })
}

async function reorderTrack(playlistId, fromIdx, toIdx) {
  await ctx.aero.playlistsReorder(playlistId, fromIdx, toIdx)
  await load()
  if (playlistId === currentPlaylistId) showPlaylistView(playlistId)
}

async function moveTrackEdge(playlistId, trackId, edge) {
  await ctx.aero.playlistsMoveEdge(playlistId, trackId, edge)
  await load()
  if (playlistId === currentPlaylistId) showPlaylistView(playlistId)
}

async function removeTrack(playlistId, trackId) {
  await ctx.aero.playlistsRemoveTrack(playlistId, trackId)
  await load()
  if (playlistId === currentPlaylistId) showPlaylistView(playlistId)
}

// ---------------------------------------------------------------------
// Agregar pistas (incluida la opcion de submenu)
// ---------------------------------------------------------------------
async function addTrackToPlaylist(playlistId, track) {
  const res = await ctx.aero.playlistsAddTrack(playlistId, track)
  if (!res.ok) {
    ctx.toast(res.error || 'No se pudo agregar a la playlist.')
    return
  }
  await load()
  const pl = playlists.find((p) => p.id === playlistId)
  if (res.duplicate) {
    ctx.toast(`Ya estaba en "${pl?.name || 'la playlist'}"`, { platform: track.source })
  } else {
    ctx.toast(`Agregado a "${pl?.name || 'playlist'}"`, { platform: track.source })
  }
}

// Devuelve la entrada de menu contextual "Agregar a playlist  >" con su submenu.
// Se usa desde queue, biblioteca, YouTube y Spotify.
function showAddToPlaylistSubmenuItems(track) {
  if (!playlists.length) {
    return {
      label: 'Agregar a playlist',
      icon: iconPlus(),
      submenu: [
        {
          label: 'Crear nueva playlist...',
          icon: iconPlus(),
          action: () => showCreateModal({ initialTrack: track }),
        },
      ],
    }
  }
  return {
    label: 'Agregar a playlist',
    icon: iconPlus(),
    submenu: [
      ...playlists.map((pl) => ({
        label: pl.name,
        thumb: pl.coverBase64 || pl.coverPath || null,
        icon: pl.coverBase64 || pl.coverPath ? '' : musicNoteIcon(15),
        action: () => addTrackToPlaylist(pl.id, track),
      })),
      { sep: true },
      {
        label: 'Crear nueva playlist...',
        icon: iconPlus(),
        action: () => showCreateModal({ initialTrack: track }),
      },
    ],
  }
}

function iconPlus() {
  return '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>'
}
function iconRename() {
  return '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 21l4-1L20 7l-3-3L4 17l-1 4z"/></svg>'
}
function iconImage() {
  return '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6"/></svg>'
}
function iconTrash() {
  return '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>'
}
function iconPlay() {
  return '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>'
}
function iconImport() {
  return '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>'
}

// ---------------------------------------------------------------------
// Menus contextuales
// ---------------------------------------------------------------------
function showEmptyAreaMenu(x, y) {
  ctx.contextMenu.show(x, y, [{ label: 'Crear playlist', icon: iconPlus(), action: () => showCreateModal() }])
}

function showPlaylistContextMenu(x, y, pl) {
  ctx.contextMenu.show(x, y, [
    { label: 'Reproducir playlist', icon: iconPlay(), action: () => playAll(pl) },
    { label: 'Agregar playlist a la cola', action: () => addAllToQueue(pl) },
    { sep: true },
    { label: 'Renombrar', icon: iconRename(), action: () => startInlineRename(pl.id) },
    { label: 'Cambiar portada', icon: iconImage(), action: () => changeCover(pl.id) },
    { sep: true },
    { label: 'Eliminar playlist', icon: iconTrash(), action: () => deletePlaylist(pl.id) },
  ])
}

function startInlineRename(playlistId) {
  const li = document.querySelector(`.my-playlist-item[data-id="${playlistId}"]`)
  if (!li) return
  const text = li.querySelector('.mp-text')
  const nameSpan = li.querySelector('.mp-name')
  const currentName = nameSpan.textContent
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'mp-rename-input'
  input.value = currentName
  input.spellcheck = false
  text.replaceChild(input, nameSpan)
  input.focus()
  input.select()

  let committed = false
  const commit = async () => {
    if (committed) return
    committed = true
    const newName = input.value.trim()
    if (newName && newName !== currentName) {
      await renamePlaylist(playlistId, newName)
    } else {
      renderSidebarList()
    }
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      committed = true
      renderSidebarList()
    }
  })
  input.addEventListener('blur', commit)
}

// ---------------------------------------------------------------------
// Modal de creacion
// ---------------------------------------------------------------------
function showCreateModal({ prefillName = '', prefillCover = null, initialTrack = null, onCreated = null } = {}) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  let coverBase64 = prefillCover || null
  let coverPath = null

  overlay.innerHTML = `
    <div class="modal-glass" role="dialog">
      <div class="modal-head">
        <span class="modal-title">Nueva playlist</span>
        <button class="modal-close" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" width="12" height="12"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="cover-picker${coverBase64 ? ' has-image' : ''}"
             style="${coverBase64 ? `background-image:url('${coverBase64}')` : ''}"
             title="Click para seleccionar imagen">
          ${coverBase64 ? '' : musicNoteIcon(28)}
        </div>
        <div class="modal-field">
          <label class="modal-label" for="pl-name">Nombre</label>
          <input id="pl-name" class="modal-input" type="text"
                 maxlength="80" placeholder="Mi nueva playlist"
                 value="${escapeHtml(prefillName)}" />
        </div>
      </div>
      <div class="modal-foot">
        <button class="modal-btn secondary" data-act="cancel">Cancelar</button>
        <button class="modal-btn" data-act="create">Crear</button>
      </div>
    </div>
  `

  document.body.appendChild(overlay)
  const input = overlay.querySelector('#pl-name')
  const createBtn = overlay.querySelector('[data-act="create"]')
  const cancelBtn = overlay.querySelector('[data-act="cancel"]')
  const closeBtn = overlay.querySelector('.modal-close')
  const picker = overlay.querySelector('.cover-picker')

  setTimeout(() => input.focus(), 0)
  if (prefillName) input.select()

  const updateCreateState = () => {
    createBtn.disabled = !input.value.trim()
  }
  updateCreateState()
  input.addEventListener('input', updateCreateState)

  picker.addEventListener('click', async () => {
    const res = await ctx.aero.openImageDialog()
    if (res && !res.canceled && res.base64) {
      coverBase64 = res.base64
      coverPath = res.path
      picker.classList.add('has-image')
      picker.style.backgroundImage = `url('${res.base64}')`
      picker.innerHTML = ''
    }
  })

  const close = () => overlay.remove()
  cancelBtn.addEventListener('click', close)
  closeBtn.addEventListener('click', close)
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) onCreate()
    if (e.key === 'Escape') close()
  })

  const onCreate = async () => {
    const name = input.value.trim()
    if (!name) return
    const pl = await createPlaylist({ name, coverPath, coverBase64 })
    close()
    if (pl) {
      if (initialTrack) await addTrackToPlaylist(pl.id, initialTrack)
      if (onCreated) onCreated(pl)
    }
  }
  createBtn.addEventListener('click', onCreate)
}

// Modal generico de confirmacion (eliminar).
function showConfirmModal({ title, message, confirmLabel = 'Aceptar', danger = false, onConfirm }) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal-glass" role="dialog">
      <div class="modal-head">
        <span class="modal-title">${escapeHtml(title)}</span>
        <button class="modal-close">
          <svg viewBox="0 0 24 24" width="12" height="12"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="modal-msg">${escapeHtml(message)}</div>
      <div class="modal-foot">
        <button class="modal-btn secondary" data-act="cancel">Cancelar</button>
        <button class="modal-btn ${danger ? 'modal-btn-danger' : ''}" data-act="ok">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  overlay.querySelector('.modal-close').addEventListener('click', close)
  overlay.querySelector('[data-act="cancel"]').addEventListener('click', close)
  overlay.querySelector('[data-act="ok"]').addEventListener('click', async () => {
    close()
    if (onConfirm) await onConfirm()
  })
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close()
  })
}

// ---------------------------------------------------------------------
// Importacion en bulk desde playlists externas
// ---------------------------------------------------------------------
async function importFromExternalPlaylist({ source, externalId, name, coverUrl, targetPlaylistId = null }) {
  // Toast con spinner mientras descarga.
  const progress = ctx.toast(`Importando canciones de "${name}"...`, {
    duration: 60000,
    progress: true,
    platform: source,
  })
  let tracks = []
  try {
    if (source === 'spotify') {
      const r = await ctx.aero.spotifyGetAllPlaylistTracks(externalId)
      if (r.ok) tracks = r.items
    } else if (source === 'youtube') {
      const r = await ctx.aero.youtubeGetAllPlaylistItems(externalId)
      if (r.ok) tracks = r.items
    }
  } catch {
    /* manejado abajo */
  }
  if (progress && progress.remove) progress.remove()

  if (!tracks.length) {
    ctx.toast(`No se pudieron importar canciones de "${name}".`, { platform: source })
    return
  }

  if (targetPlaylistId) {
    const r = await ctx.aero.playlistsAddBulk(targetPlaylistId, tracks)
    await load()
    const target = playlists.find((p) => p.id === targetPlaylistId)
    ctx.toast(`Importadas ${r.added} en "${target?.name}"`, { platform: source })
  } else {
    // Crear nueva con nombre + portada precargados.
    showCreateModal({
      prefillName: name,
      prefillCover: coverUrl || null,
      onCreated: async (pl) => {
        const r = await ctx.aero.playlistsAddBulk(pl.id, tracks)
        await load()
        ctx.toast(`Importadas ${r.added} canciones`, { platform: source })
      },
    })
  }
}
