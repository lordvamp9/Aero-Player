/* =====================================================================
   AERO PLAYER  ·  drag-drop.js
   Arrastrar y soltar hacia la cola:
     - Pistas de la biblioteca (tipo application/x-aero-track)
     - Archivos de audio/video soltados desde el sistema operativo
   El reordenamiento interno de la cola se gestiona en queue.js.
   ===================================================================== */

import { formatTime } from './app.js'

const AUDIO_EXT = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus', '.wma', '.mp4', '.webm', '.mkv', '.mov']

export function initDragDrop(ctx) {
  const dropZones = [ctx.els.queueList, ctx.els.canvas, ctx.els.nowPlaying]

  // Evita que Electron navegue al soltar un archivo fuera de las zonas.
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', (e) => e.preventDefault())

  dropZones.forEach((zone) => {
    if (!zone) return
    zone.addEventListener('dragover', (e) => {
      if (hasTrack(e) || hasFiles(e)) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        zone.classList.add('drop-active')
      }
    })
    zone.addEventListener('dragleave', () => zone.classList.remove('drop-active'))
    zone.addEventListener('drop', async (e) => {
      zone.classList.remove('drop-active')
      // Reordenamiento interno: lo maneja queue.js.
      if (e.dataTransfer.types.includes('application/x-aero-reorder')) return

      if (hasTrack(e)) {
        e.preventDefault()
        const track = JSON.parse(e.dataTransfer.getData('application/x-aero-track'))
        ctx.queue.add(track)
        return
      }
      if (hasFiles(e)) {
        e.preventDefault()
        await handleFiles(ctx, e.dataTransfer.files)
      }
    })
  })
}

function hasTrack(e) {
  return e.dataTransfer && e.dataTransfer.types.includes('application/x-aero-track')
}
function hasFiles(e) {
  return e.dataTransfer && e.dataTransfer.types.includes('Files')
}

async function handleFiles(ctx, fileList) {
  const files = [...fileList].filter((f) => {
    const path = f.path || f.name
    const ext = '.' + path.split('.').pop().toLowerCase()
    return AUDIO_EXT.includes(ext)
  })
  if (!files.length) {
    ctx.toast('No se reconocieron archivos de audio o video.')
    return
  }

  let count = 0
  for (const file of files) {
    const filePath = file.path
    if (!filePath) continue // navegador: sin acceso a la ruta real
    const meta = await ctx.aero.readMetadata(filePath)
    ctx.queue.add(
      {
        source: 'local',
        title: meta.title || file.name,
        artist: meta.artist || 'Artista desconocido',
        album: meta.album || 'Album desconocido',
        genre: meta.genre || 'Sin genero',
        duration: meta.duration || 0,
        durationFormatted: meta.durationFormatted || formatTime(meta.duration),
        coverUrl: meta.coverUrl || null,
        filePath,
        codec: meta.codec || null,
        bitrate: meta.bitrate || null,
      },
      { silent: true }
    )
    count++
  }
  if (count) ctx.toast(`${count} ${count === 1 ? 'archivo agregado' : 'archivos agregados'} a la cola`)
}
