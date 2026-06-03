'use strict'

// Escaneo recursivo de carpetas en busca de archivos de audio y video,
// usando unicamente los modulos nativos fs y path.
const fs = require('fs')
const path = require('path')

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus', '.wma'])
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov'])
const ALL_EXT = new Set([...AUDIO_EXT, ...VIDEO_EXT])

// Carpetas que nunca conviene recorrer.
const SKIP_DIRS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information', '.git'])

/**
 * Recorre una carpeta de forma recursiva y devuelve la lista de rutas de
 * archivos multimedia encontrados. Limita la profundidad para evitar bucles.
 */
function scanFolder(folderPath, maxDepth = 12) {
  const found = []

  function walk(dir, depth) {
    if (depth > maxDepth) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        walk(full, depth + 1)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (ALL_EXT.has(ext)) {
          found.push({
            filePath: full,
            fileName: entry.name,
            ext,
            kind: VIDEO_EXT.has(ext) ? 'video' : 'audio',
          })
        }
      }
    }
  }

  walk(folderPath, 0)
  return found
}

module.exports = { scanFolder, AUDIO_EXT, VIDEO_EXT }
