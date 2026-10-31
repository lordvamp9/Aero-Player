/* =====================================================================
   AERO PLAYER  ·  build/generate-icon.mjs
   Convierte build/konata.png en build/icon.ico (multi-resolución) y en
   build/icon.png (PNG maestro para Linux y macOS). El .ico embebe los
   tamaños 16/24/32/48/64/128/256 para que Windows muestre el icono
   nítido en explorador, barra de tareas, alt-tab e instalador NSIS.
   Ejecutar con: npm run icon
   ===================================================================== */

import { createCanvas, loadImage } from '@napi-rs/canvas'
import pngToIco from 'png-to-ico'
import { writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(__dirname, 'konata.png')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const MASTER_SIZE = 256

// Margen relativo alrededor del personaje para que el icono respire dentro
// del cuadrado y no quede pegado a los bordes a tamaños pequeños.
const PADDING_RATIO = 0.04

function renderIcon(image, size) {
  const canvas = createCanvas(size, size)
  const c = canvas.getContext('2d')
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'

  const pad = Math.round(size * PADDING_RATIO)
  const target = size - pad * 2

  // Escala la imagen original al cuadrado disponible conservando la
  // proporción para no deformar el dibujo.
  const ratio = Math.min(target / image.width, target / image.height)
  const w = Math.round(image.width * ratio)
  const h = Math.round(image.height * ratio)
  const x = Math.round((size - w) / 2)
  const y = Math.round((size - h) / 2)

  c.drawImage(image, x, y, w, h)
  return canvas
}

async function main() {
  if (!existsSync(SOURCE)) {
    throw new Error(`No se encontró ${SOURCE}. Colócalo en build/konata.png.`)
  }

  const image = await loadImage(SOURCE)

  // PNG maestro a 256 px para Linux y macOS.
  const masterPng = renderIcon(image, MASTER_SIZE).toBuffer('image/png')
  writeFileSync(join(__dirname, 'icon.png'), masterPng)

  // Un PNG por cada tamaño objetivo, combinados en un solo .ico.
  const pngBuffers = ICO_SIZES.map((sz) => renderIcon(image, sz).toBuffer('image/png'))
  const ico = await pngToIco(pngBuffers)
  writeFileSync(join(__dirname, 'icon.ico'), ico)

  console.log('Icono generado a partir de build/konata.png:')
  console.log('  build/icon.png  (' + MASTER_SIZE + 'x' + MASTER_SIZE + ')')
  console.log('  build/icon.ico  (multi-res: ' + ICO_SIZES.join(', ') + ')')
}

main().catch((err) => {
  console.error('No se pudo generar el icono:', err)
  process.exit(1)
})
