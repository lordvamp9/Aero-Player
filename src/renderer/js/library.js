/* =====================================================================
   AERO PLAYER  ·  library.js
   Biblioteca local: escaneo de carpetas, lectura de metadatos, agrupacion
   por album/artista/genero y renderizado de la vista de listas.
   ===================================================================== */

import { platformIcon, escapeHtml, formatTime } from './app.js'

let ctx
let currentView = 'all'

export function initLibrary(context) {
  ctx = context

  ctx.library = {
    addFolder,
    scan,
    renderView,
    search,
    getTracks: () => ctx.state.library,
  }

  ctx.els.listViewClose.addEventListener('click', hideListView)
  ctx.on('search', (term) => search(term))
  ctx.on('favorites-changed', () => {
    if (currentView === 'favorites') renderView('favorites')
  })
}

// ---------------------------------------------------------------------
// Escaneo
// ---------------------------------------------------------------------
async function addFolder() {
  const res = await ctx.aero.openFolderDialog()
  if (res.canceled || !res.folderPath) return
  await scan(res.folderPath)
}

async function scan(folderPath) {
  ctx.els.statusCenter.textContent = 'Escaneando carpeta...'
  const res = await ctx.aero.scanFolder(folderPath)
  if (!res.ok) {
    ctx.toast('No se pudo escanear la carpeta seleccionada.')
    ctx.els.statusCenter.textContent = 'Aero Player listo'
    return
  }
  const files = res.files
  if (!files.length) {
    ctx.toast('No se encontraron archivos de audio en la carpeta.')
    ctx.els.statusCenter.textContent = 'Aero Player listo'
    return
  }

  // Lee metadatos en lotes para no saturar el canal IPC.
  const known = new Set(ctx.state.library.map((t) => t.filePath))
  const pending = files.filter((f) => !known.has(f.filePath))
  const batchSize = 6
  let added = 0

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize)
    const metas = await Promise.all(batch.map((f) => ctx.aero.readMetadata(f.filePath)))
    metas.forEach((meta, j) => {
      ctx.state.library.push(buildTrack(batch[j], meta))
      added++
    })
    ctx.els.statusCenter.textContent = `Escaneando... ${Math.min(i + batchSize, pending.length)}/${pending.length}`
  }

  ctx.persist.library()
  ctx.els.statusCenter.textContent = 'Aero Player listo'
  ctx.toast(`Carpeta escaneada: ${added} ${added === 1 ? 'archivo' : 'archivos'}`)
  renderView('all')
}

function buildTrack(file, meta) {
  return {
    id: 'local-' + hashPath(file.filePath),
    source: 'local',
    title: meta.title || file.fileName,
    artist: meta.artist || 'Artista desconocido',
    album: meta.album || 'Album desconocido',
    genre: meta.genre || 'Sin genero',
    year: meta.year || null,
    duration: meta.duration || 0,
    durationFormatted: meta.durationFormatted || formatTime(meta.duration),
    coverUrl: meta.coverUrl || null,
    filePath: file.filePath,
    codec: meta.codec || file.ext.slice(1).toUpperCase(),
    bitrate: meta.bitrate || null,
    kind: file.kind,
  }
}

function hashPath(p) {
  let h = 0
  for (let i = 0; i < p.length; i++) {
    h = (h << 5) - h + p.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

// ---------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------
function renderView(view) {
  currentView = view
  const tracks = ctx.state.library

  let title = 'Toda la musica'
  let body

  if (view === 'all') {
    title = 'Toda la musica'
    body = renderFlatList(tracks)
  } else if (view === 'favorites') {
    title = 'Favoritos'
    body = renderFlatList(ctx.state.favorites)
  } else if (view === 'albums') {
    title = 'Albumes'
    body = renderGrouped(tracks, 'album')
  } else if (view === 'artists') {
    title = 'Artistas'
    body = renderGrouped(tracks, 'artist')
  } else if (view === 'genres') {
    title = 'Generos'
    body = renderGrouped(tracks, 'genre')
  } else {
    body = renderFlatList(tracks)
  }

  showListView(title, tracks.length, body)
}

function showListView(title, count, bodyEl) {
  ctx.els.listViewTitle.textContent = title
  ctx.els.listViewCount.textContent =
    count > 0 ? `${count} ${count === 1 ? 'pista' : 'pistas'}` : ''
  ctx.els.listViewBody.innerHTML = ''
  ctx.els.listViewBody.appendChild(bodyEl)
  ctx.els.listView.hidden = false
  ctx.els.nowPlaying.style.opacity = '0.15'
}

function hideListView() {
  ctx.els.listView.hidden = true
  ctx.els.nowPlaying.style.opacity = '1'
}

function renderFlatList(tracks) {
  const frag = document.createDocumentFragment()
  if (!tracks.length) {
    frag.appendChild(emptyMessage())
    return frag
  }
  tracks.forEach((track, i) => frag.appendChild(trackRow(track, i + 1)))
  return frag
}

function renderGrouped(tracks, key) {
  const frag = document.createDocumentFragment()
  if (!tracks.length) {
    frag.appendChild(emptyMessage())
    return frag
  }
  const groups = new Map()
  tracks.forEach((t) => {
    const k = t[key] || 'Sin datos'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(t)
  })
  ;[...groups.keys()].sort((a, b) => a.localeCompare(b)).forEach((groupName) => {
    const header = document.createElement('div')
    header.className = 'group-header'
    header.textContent = groupName
    frag.appendChild(header)
    groups.get(groupName).forEach((t, i) => frag.appendChild(trackRow(t, i + 1)))
  })
  return frag
}

function trackRow(track, index) {
  const row = document.createElement('div')
  row.className = 'track-row'
  if (track.id === ctx.state.currentId) row.classList.add('active')
  const cover = track.coverUrl ? `background-image:url("${track.coverUrl}")` : ''
  row.innerHTML = `
    <span class="tr-index">${index}</span>
    <span class="tr-cover" style="${cover}">${track.coverUrl ? '' : platformIcon(track.source, 16)}</span>
    <span class="tr-main">
      <span class="tr-title">${escapeHtml(track.title)}</span>
      <span class="tr-sub">${escapeHtml(track.artist)}</span>
    </span>
    <span class="tr-album">${escapeHtml(track.album || '')}</span>
    <span class="tr-platform">${platformIcon(track.source, 14)}</span>
    <span class="tr-dur">${track.durationFormatted || ''}</span>
  `
  row.addEventListener('click', () => playFromLibrary(track))
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    ctx.contextMenu.show(e.clientX, e.clientY, [
      { label: 'Reproducir ahora', icon: '', action: () => playFromLibrary(track) },
      { label: 'Agregar a la cola', icon: '', action: () => ctx.queue.add({ ...track }) },
      { sep: true },
      { label: 'Agregar a favoritos', icon: '', action: () => addFav(track) },
    ])
  })
  // Permite arrastrar pistas de la biblioteca hacia la cola.
  row.draggable = true
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('application/x-aero-track', JSON.stringify(track))
  })
  return row
}

function playFromLibrary(track) {
  let item = ctx.state.queue.find((i) => i.filePath && i.filePath === track.filePath)
  if (!item) {
    const id = ctx.queue.add({ ...track }, { silent: true })
    item = ctx.state.queue.find((i) => i.id === id)
  }
  ctx.player.playItem(item)
}

function addFav(track) {
  ctx.state.favorites.push({ ...track })
  ctx.persist.favorites()
  ctx.emit('favorites-changed')
  ctx.toast('Agregada a favoritos', { platform: track.source })
}

function emptyMessage() {
  const div = document.createElement('div')
  div.className = 'list-empty'
  div.innerHTML =
    'Tu biblioteca esta vacia.<br>Usa <strong>Agregar carpeta</strong> en la barra lateral para escanear tu musica.'
  return div
}

// ---------------------------------------------------------------------
// Busqueda global (parte local)
// ---------------------------------------------------------------------
function search(term) {
  if (!term) {
    if (currentView === 'search') hideListView()
    return
  }
  const q = term.toLowerCase()
  const results = ctx.state.library.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      (t.album || '').toLowerCase().includes(q)
  )
  currentView = 'search'
  showListView(`Resultados para "${term}"`, results.length, renderFlatList(results))
}
