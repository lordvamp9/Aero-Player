/* =====================================================================
   AERO PLAYER  ·  build/generate-icon.mjs
   Genera build/icon.ico (multi-resolucion) y build/icon.png con el mismo
   disco musical en estetica Aero. El .ico embebe 16/24/32/48/64/128/256
   para que Windows lo muestre nitido en explorador, taskbar, alt-tab e
   instalador NSIS.
   Ejecutar con: npm run icon
   ===================================================================== */

import { createCanvas } from '@napi-rs/canvas'
import pngToIco from 'png-to-ico'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const MASTER_SIZE = 256

function roundRect(c, x, y, w, h, r) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

// Dibuja el icono Aero a cualquier tamano usando coordenadas relativas a 256.
function drawIcon(size) {
  const canvas = createCanvas(size, size)
  const c = canvas.getContext('2d')
  const s = size / MASTER_SIZE
  const cx = size / 2
  const cy = size / 2

  // Fondo redondeado tipo cristal
  const bg = c.createLinearGradient(0, 0, 0, size)
  bg.addColorStop(0, '#0b2050')
  bg.addColorStop(1, '#03102b')
  roundRect(c, 8 * s, 8 * s, size - 16 * s, size - 16 * s, 46 * s)
  c.fillStyle = bg
  c.fill()

  // Brillo superior
  const shine = c.createLinearGradient(0, 8 * s, 0, size / 2)
  shine.addColorStop(0, 'rgba(180,220,255,0.22)')
  shine.addColorStop(1, 'rgba(180,220,255,0)')
  roundRect(c, 8 * s, 8 * s, size - 16 * s, size / 2, 46 * s)
  c.fillStyle = shine
  c.fill()

  // Disco principal
  const discR = 78 * s
  const disc = c.createRadialGradient(cx, cy - 20 * s, 8 * s, cx, cy, discR)
  disc.addColorStop(0, '#bfe0ff')
  disc.addColorStop(0.45, '#3f86ff')
  disc.addColorStop(1, '#0a2a78')
  c.beginPath()
  c.arc(cx, cy, discR, 0, Math.PI * 2)
  c.fillStyle = disc
  c.fill()

  // Surcos del disco (omitir a tamanos chicos donde se vuelven ruido)
  if (size >= 32) {
    c.strokeStyle = 'rgba(255,255,255,0.10)'
    c.lineWidth = Math.max(1, 2 * s)
    for (let r = 26 * s; r < discR; r += 9 * s) {
      c.beginPath()
      c.arc(cx, cy, r, 0, Math.PI * 2)
      c.stroke()
    }
  }

  // Centro del disco
  c.beginPath()
  c.arc(cx, cy, 20 * s, 0, Math.PI * 2)
  c.fillStyle = '#06122b'
  c.fill()
  c.beginPath()
  c.arc(cx, cy, 6 * s, 0, Math.PI * 2)
  c.fillStyle = '#bfe0ff'
  c.fill()

  // Halo de brillo (solo a tamanos medios/grandes)
  if (size >= 48) {
    c.beginPath()
    c.arc(cx, cy, discR + 6 * s, 0, Math.PI * 2)
    c.strokeStyle = 'rgba(140,200,255,0.5)'
    c.lineWidth = Math.max(1, 2 * s)
    c.stroke()
  }

  return canvas
}

async function main() {
  // PNG maestro (256) sirve como icon.png para Linux/macOS y referencia.
  const masterPng = drawIcon(MASTER_SIZE).toBuffer('image/png')
  writeFileSync(join(__dirname, 'icon.png'), masterPng)

  // Genera un PNG por cada tamano objetivo y los combina en un solo .ico.
  const pngBuffers = ICO_SIZES.map((sz) => drawIcon(sz).toBuffer('image/png'))
  const ico = await pngToIco(pngBuffers)
  writeFileSync(join(__dirname, 'icon.ico'), ico)

  console.log('Icono generado:')
  console.log('  build/icon.png  (' + MASTER_SIZE + 'x' + MASTER_SIZE + ')')
  console.log('  build/icon.ico  (multi-res: ' + ICO_SIZES.join(', ') + ')')
}

main().catch((err) => {
  console.error('No se pudo generar el icono:', err)
  process.exit(1)
})
