/* =====================================================================
   AERO PLAYER  ·  build/capture-screenshot.mjs
   Abre la interfaz ya compilada en una ventana de Electron y captura una
   imagen real para el README (assets/screenshot.png).
   Ejecutar con: npx electron build/capture-screenshot.mjs
   ===================================================================== */

import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false,
    frame: false,
    backgroundColor: '#030712',
    webPreferences: {
      preload: join(root, 'src/main/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  await win.loadFile(join(root, 'dist/index.html'))
  // Espera a que el visualizador anime unos segundos.
  await new Promise((r) => setTimeout(r, 2600))

  const image = await win.webContents.capturePage()
  writeFileSync(join(root, 'assets/screenshot.png'), image.toPNG())
  console.log('Captura guardada en assets/screenshot.png')
  app.quit()
})
