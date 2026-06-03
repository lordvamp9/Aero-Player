/* =====================================================================
   AERO PLAYER  ·  build/generate-icon.mjs
   Genera build/icon.ico (y icon.png) dibujando con canvas un disco musical
   con estetica Aero azul. Ejecutar con: npm run icon
   ===================================================================== */

import { createCanvas } from '@napi-rs/canvas'
import pngToIco from 'png-to-ico'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SIZE = 256

function drawIcon() {
  const canvas = createCanvas(SIZE, SIZE)
  const c = canvas.getContext('2d')
  const cx = SIZE / 2
  const cy = SIZE / 2

  // Fondo redondeado tipo cristal
  const bg = c.createLinearGradient(0, 0, 0, SIZE)
  bg.addColorStop(0, '#0b2050')
  bg.addColorStop(1, '#03102b')
  roundRect(c, 8, 8, SIZE - 16, SIZE - 16, 46)
  c.fillStyle = bg
  c.fill()

  // Brillo superior
  const shine = c.createLinearGradient(0, 8, 0, SIZE / 2)
  shine.addColorStop(0, 'rgba(180,220,255,0.22)')
  shine.addColorStop(1, 'rgba(180,220,255,0)')
  roundRect(c, 8, 8, SIZE - 16, SIZE / 2, 46)
  c.fillStyle = shine
  c.fill()

  // Disco principal
  const discR = 78
  const disc = c.createRadialGradient(cx, cy - 20, 8, cx, cy, discR)
  disc.addColorStop(0, '#bfe0ff')
  disc.addColorStop(0.45, '#3f86ff')
  disc.addColorStop(1, '#0a2a78')
  c.beginPath()
  c.arc(cx, cy, discR, 0, Math.PI * 2)
  c.fillStyle = disc
  c.fill()

  // Surcos del disco
  c.strokeStyle = 'rgba(255,255,255,0.10)'
  c.lineWidth = 2
  for (let r = 26; r < discR; r += 9) {
    c.beginPath()
    c.arc(cx, cy, r, 0, Math.PI * 2)
    c.stroke()
  }

  // Centro
  c.beginPath()
  c.arc(cx, cy, 20, 0, Math.PI * 2)
  c.fillStyle = '#06122b'
  c.fill()
  c.beginPath()
  c.arc(cx, cy, 6, 0, Math.PI * 2)
  c.fillStyle = '#bfe0ff'
  c.fill()

  // Halo de brillo
  c.beginPath()
  c.arc(cx, cy, discR + 6, 0, Math.PI * 2)
  c.strokeStyle = 'rgba(140,200,255,0.5)'
  c.lineWidth = 2
  c.stroke()

  return canvas
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

async function main() {
  const canvas = drawIcon()
  const png = canvas.toBuffer('image/png')
  writeFileSync(join(__dirname, 'icon.png'), png)
  const ico = await pngToIco(png)
  writeFileSync(join(__dirname, 'icon.ico'), ico)
  console.log('Icono generado: build/icon.ico y build/icon.png')
}

main().catch((err) => {
  console.error('No se pudo generar el icono:', err)
  process.exit(1)
})
