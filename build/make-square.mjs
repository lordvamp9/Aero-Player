/* Genera build/icon-square.png (1024x1024) a partir de build/konata.png,
   centrando la imagen y conservando proporcion, para alimentar `tauri icon`. */
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SIZE = 1024
const PADDING = 0.04

const img = await loadImage(join(__dirname, 'konata.png'))
const canvas = createCanvas(SIZE, SIZE)
const c = canvas.getContext('2d')
c.imageSmoothingEnabled = true
c.imageSmoothingQuality = 'high'

const avail = SIZE * (1 - PADDING * 2)
const scale = Math.min(avail / img.width, avail / img.height)
const w = img.width * scale
const h = img.height * scale
c.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h)

writeFileSync(join(__dirname, 'icon-square.png'), canvas.toBuffer('image/png'))
console.log('build/icon-square.png (1024x1024) generado desde konata.png')
