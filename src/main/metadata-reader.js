'use strict'

// Lectura de metadatos ID3 / tags con music-metadata: titulo, artista, album,
// genero, duracion y caratula embebida (convertida a data URL base64).
const mm = require('music-metadata')
const path = require('path')

function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Lee los metadatos de un archivo local. Si falla, devuelve datos minimos
 * derivados del nombre del archivo para no romper la biblioteca.
 */
async function readMetadata(filePath) {
  const fileName = path.basename(filePath, path.extname(filePath))
  try {
    const meta = await mm.parseFile(filePath, { duration: true })
    const common = meta.common || {}
    const format = meta.format || {}

    let coverUrl = null
    const pic = common.picture && common.picture[0]
    if (pic && pic.data) {
      const b64 = Buffer.from(pic.data).toString('base64')
      coverUrl = `data:${pic.format || 'image/jpeg'};base64,${b64}`
    }

    return {
      title: common.title || fileName,
      artist: common.artist || (common.artists && common.artists[0]) || 'Artista desconocido',
      album: common.album || 'Album desconocido',
      genre: (common.genre && common.genre[0]) || 'Sin genero',
      year: common.year || null,
      trackNo: (common.track && common.track.no) || null,
      duration: format.duration || 0,
      durationFormatted: formatDuration(format.duration),
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : null,
      codec: format.codec || format.container || path.extname(filePath).slice(1).toUpperCase(),
      sampleRate: format.sampleRate || null,
      coverUrl,
    }
  } catch {
    return {
      title: fileName,
      artist: 'Artista desconocido',
      album: 'Album desconocido',
      genre: 'Sin genero',
      year: null,
      trackNo: null,
      duration: 0,
      durationFormatted: '0:00',
      bitrate: null,
      codec: path.extname(filePath).slice(1).toUpperCase(),
      sampleRate: null,
      coverUrl: null,
    }
  }
}

module.exports = { readMetadata, formatDuration }
