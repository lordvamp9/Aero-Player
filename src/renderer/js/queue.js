/* =====================================================================
   AERO PLAYER  ·  queue.js
   Cola de reproduccion unificada cross-platform (local, youtube, spotify).
   Renderiza la lista, gestiona reordenamiento por arrastre, menu contextual
   glass y el ecualizador animado de la pista activa.
   ===================================================================== */

import { platformIcon, escapeHtml } from './app.js'

let ctx

export function initQueue(context) {
  ctx = context

  ctx.queue = {
    add,
    addMany,
    addNext,
    remove,
    move,
    clear,
    toTop,
    render,
    getItems: () => ctx.state.queue,
  }

  // Menu contextual reutilizable por la cola y la biblioteca.
  ctx.contextMenu = { show: showContextMenu, hide: hideContextMenu }

  ctx.on('queue-changed', render)
  ctx.on('track-changed', render)
  ctx.on('play-state', updateActiveState)

  wireQueueDnD()
  wireContextDismiss()
  render()
}

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || 'q-' + Math.random().toString(36).slice(2)
}

// ---------------------------------------------------------------------
// Operaciones de cola
// ---------------------------------------------------------------------
function normalize(item) {
  return { id: item.id || uid(), ...item }
}

function add(item, { silent = false } = {}) {
  const it = normalize(item)
  ctx.state.queue.push(it)
  changed()
  if (!silent) ctx.toast(`Agregada a la cola: ${it.title}`, { platform: it.source })
  return it.id
}

function addMany(items) {
  items.forEach((it) => ctx.state.queue.push(normalize(it)))
  changed()
  ctx.toast(`${items.length} canciones agregadas a la cola`)
}

function addNext(item) {
  const it = normalize(item)
  const idx = ctx.state.queue.findIndex((i) => i.id === ctx.state.currentId)
  ctx.state.queue.splice(idx + 1, 0, it)
  changed()
  return it.id
}

function remove(id) {
  const wasCurrent = ctx.state.currentId === id
  ctx.state.queue = ctx.state.queue.filter((i) => i.id !== id)
  if (wasCurrent) ctx.state.currentId = null
  changed()
}

function move(fromIdx, toIdx) {
  const q = ctx.state.queue
  if (fromIdx < 0 || fromIdx >= q.length) return
  const [item] = q.splice(fromIdx, 1)
  q.splice(toIdx, 0, item)
  changed()
}

function toTop(id) {
  const q = ctx.state.queue
  const idx = q.findIndex((i) => i.id === id)
  if (idx > 0) {
    const [item] = q.splice(idx, 1)
    q.unshift(item)
    changed()
  }
}

function clear() {
  ctx.state.queue = []
  ctx.state.currentId = null
  changed()
}

function changed() {
  ctx.emit('queue-changed')
  ctx.updateStatusBar()
}

// ---------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------
function render() {
  const list = ctx.els.queueList
  const q = ctx.state.queue
  ctx.els.queueCount.textContent = q.length
  ctx.els.queueEmpty.style.display = q.length ? 'none' : 'block'

  list.innerHTML = ''
  q.forEach((item) => {
    const li = document.createElement('li')
    li.className = 'queue-item'
    li.dataset.id = item.id
    li.draggable = true
    if (item.id === ctx.state.currentId) {
      li.classList.add('active')
      if (!ctx.state.isPlaying) li.classList.add('paused')
    }

    const cover = item.coverUrl ? `background-image:url("${item.coverUrl}")` : ''
    li.innerHTML = `
      <span class="qi-platform">${platformIcon(item.source, 14)}</span>
      <span class="qi-cover" style="${cover}"></span>
      <span class="qi-text">
        <span class="qi-title">${escapeHtml(item.title)}</span>
        <span class="qi-artist">${escapeHtml(item.artist || '')}</span>
      </span>
      <span class="qi-dur">${item.durationFormatted || ''}</span>
      <span class="qi-eq"><span></span><span></span><span></span></span>
    `

    li.addEventListener('dblclick', () => ctx.player.playItem(item))
    li.addEventListener('click', (e) => {
      if (e.detail === 1) {
        // Un click selecciona visualmente; doble click reproduce.
      }
    })
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      openQueueMenu(e, item)
    })
    list.appendChild(li)
  })
}

function updateActiveState() {
  ctx.els.queueList.querySelectorAll('.queue-item').forEach((li) => {
    const isActive = li.dataset.id === ctx.state.currentId
    li.classList.toggle('active', isActive)
    li.classList.toggle('paused', isActive && !ctx.state.isPlaying)
  })
}

// ---------------------------------------------------------------------
// Reordenamiento por arrastre dentro de la cola (HTML5 Drag and Drop)
// ---------------------------------------------------------------------
function wireQueueDnD() {
  const list = ctx.els.queueList
  let dragId = null

  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.queue-item')
    if (!li) return
    dragId = li.dataset.id
    li.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    // Marca el origen para que drag-drop.js sepa que es un reorden interno.
    e.dataTransfer.setData('application/x-aero-reorder', dragId)
  })

  list.addEventListener('dragend', (e) => {
    const li = e.target.closest('.queue-item')
    if (li) li.classList.remove('dragging')
    list.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'))
    dragId = null
  })

  list.addEventListener('dragover', (e) => {
    if (!dragId) return
    e.preventDefault()
    const over = e.target.closest('.queue-item')
    list.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'))
    if (over && over.dataset.id !== dragId) over.classList.add('drag-over')
  })

  list.addEventListener('drop', (e) => {
    if (!dragId) return
    e.preventDefault()
    const over = e.target.closest('.queue-item')
    const q = ctx.state.queue
    const from = q.findIndex((i) => i.id === dragId)
    let to = over ? q.findIndex((i) => i.id === over.dataset.id) : q.length - 1
    if (from !== -1 && to !== -1 && from !== to) move(from, to)
    dragId = null
  })
}

// ---------------------------------------------------------------------
// Menu contextual
// ---------------------------------------------------------------------
function openQueueMenu(e, item) {
  showContextMenu(e.clientX, e.clientY, [
    { label: 'Reproducir ahora', icon: iconPlay(), action: () => ctx.player.playItem(item) },
    { label: 'Mover al inicio de la cola', icon: iconTop(), action: () => toTop(item.id) },
    { sep: true },
    {
      label: isFavorite(item) ? 'Quitar de favoritos' : 'Agregar a favoritos',
      icon: iconHeart(),
      action: () => toggleFavorite(item),
    },
    { sep: true },
    { label: 'Eliminar de la cola', icon: iconTrash(), action: () => remove(item.id) },
  ])
}

function showContextMenu(x, y, items) {
  const menu = ctx.els.contextMenu
  menu.innerHTML = '<div class="glass-shine-layer"></div>'
  items.forEach((it) => {
    if (it.sep) {
      const sep = document.createElement('div')
      sep.className = 'ctx-sep'
      menu.appendChild(sep)
      return
    }
    const row = document.createElement('div')
    row.className = 'ctx-item'
    row.innerHTML = `${it.icon || ''}<span>${escapeHtml(it.label)}</span>`
    row.addEventListener('click', () => {
      hideContextMenu()
      it.action && it.action()
    })
    menu.appendChild(row)
  })

  menu.hidden = false
  // Ajusta para que no se salga de la ventana.
  const rect = menu.getBoundingClientRect()
  const px = Math.min(x, window.innerWidth - rect.width - 8)
  const py = Math.min(y, window.innerHeight - rect.height - 8)
  menu.style.left = px + 'px'
  menu.style.top = py + 'px'
}

function hideContextMenu() {
  ctx.els.contextMenu.hidden = true
}

function wireContextDismiss() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#context-menu')) hideContextMenu()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu()
  })
  window.addEventListener('blur', hideContextMenu)
  window.addEventListener('resize', hideContextMenu)
}

// ---------------------------------------------------------------------
// Favoritos
// ---------------------------------------------------------------------
function favKey(item) {
  return item.filePath || item.videoId || item.spotifyId || item.title
}
function isFavorite(item) {
  return ctx.state.favorites.some((f) => favKey(f) === favKey(item))
}
function toggleFavorite(item) {
  if (isFavorite(item)) {
    ctx.state.favorites = ctx.state.favorites.filter((f) => favKey(f) !== favKey(item))
    ctx.toast('Quitada de favoritos')
  } else {
    ctx.state.favorites.push(item)
    ctx.toast('Agregada a favoritos', { platform: item.source })
  }
  ctx.persist.favorites()
  ctx.emit('favorites-changed')
}

// ---------------------------------------------------------------------
// Iconos de menu (SVG inline)
// ---------------------------------------------------------------------
function iconPlay() {
  return svg('<path fill="currentColor" d="M8 5v14l11-7z"/>')
}
function iconTop() {
  return svg('<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 19V6M6 11l6-6 6 6"/>')
}
function iconHeart() {
  return svg('<path fill="none" stroke="currentColor" stroke-width="2" d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5C19 15.5 12 20 12 20z"/>')
}
function iconTrash() {
  return svg('<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>')
}
function svg(inner) {
  return `<svg viewBox="0 0 24 24" width="15" height="15">${inner}</svg>`
}

export { showContextMenu }
