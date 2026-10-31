# Aero Player — Arquitectura Tauri

Aero Player corre sobre **Tauri 2 + WebView2** (Edge nativo de Windows).
Este documento describe la estructura del proyecto y los comandos disponibles.

## Estructura

```
aero-player/
├── src-tauri/              # Backend Rust (Tauri 2.11)
│   ├── src/
│   │   ├── main.rs         # Entry point (llama a aero_player_lib::run)
│   │   └── lib.rs          # Comandos: oauth_listen, scan_folder, read_metadata
│   ├── capabilities/
│   │   └── default.json    # Permisos: dialog, fs, opener, store
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json     # Config produccion
│   └── tauri-probe.conf.json  # Config para sonda Widevine
│
├── src/renderer/           # Frontend (HTML/CSS/JS, sin cambios desde Electron)
│   └── js/
│       ├── aero-tauri.js   # Bridge window.aero sobre plugins de Tauri
│       ├── app.js, player.js, visualizer.js, ...
│
├── tauri-probe/            # Sonda Widevine / EME (diagnostico)
│   └── index.html
│
├── build/                  # Iconos y generadores
├── dist/                   # Bundle de Vite (generado)
└── vite.config.js
```

## Prerequisites

- **Node.js 20+**
- **Rust + Cargo** (instalar con [rustup](https://rustup.rs/))
- **MSVC Build Tools 2022** (en Windows)
- **WebView2 Runtime** (preinstalado en Windows 10/11 actualizado)

## Comandos

| Comando | Que hace |
|---|---|
| `npm install` | Instala deps JS |
| `npm run vite` | Solo Vite dev server (puerto 5173) |
| `npm run dev` | Tauri dev (Vite + ventana nativa) |
| `npm run build` | Bundle de Vite a `dist/` |
| `npm run tauri:build` | Compila .msi + NSIS en `src-tauri/target/release/bundle/` |
| `npm run tauri:probe` | Lanza la sonda Widevine (sin Vite) |
| `npm run icon` | Regenera iconos |
| `npm run clean` | Limpia `dist/`, `release/`, `src-tauri/target/` |

## Backend Rust (lib.rs)

Comandos Tauri expuestos al renderer via `invoke()`:

- **`oauth_listen(port, path, provider)`** — Servidor TCP local de un solo uso
  para recibir el callback OAuth de Google/Spotify.
- **`scan_folder(path)`** — Escaneo recursivo con `walkdir`, filtra extensiones
  de audio/video.
- **`read_metadata(filePath)`** — Lee tags ID3 / Vorbis con `lofty`, extrae
  cover art a base64.

## Plugins Tauri

- `tauri-plugin-dialog` — Dialogos nativos (abrir carpeta, abrir imagen)
- `tauri-plugin-fs` — Lectura de archivos locales
- `tauri-plugin-opener` — Abrir URLs en navegador
- `tauri-plugin-store` — Persistencia JSON (reemplazo de electron-store)

## Widevine / Spotify

WebView2 incluye **Widevine nativo** en Windows 10/11. No requiere firma EVS
ni binarios castlabs. Spotify Web Playback funciona out-of-the-box.

Para diagnosticar el soporte EME en tu sistema:

```bash
npm run tauri:probe
```

Abre una ventana con tests interactivos de Widevine, PlayReady y un mock del
flujo Spotify.

## Migracion completada desde Electron

Se eliminaron del proyecto:

- `src/main/` (proceso principal Electron)
- `electron-builder.config.js`
- `build/evs-sign.js` (firma EVS)
- `build/installer.nsh`
- Dependencias: `electron`, `electron-builder`, `electron-store`, `dotenv`,
  `google-auth-library`, `googleapis`, `music-metadata`, `uuid`, `concurrently`

La UI (`src/renderer/`) permanece intacta y se comunica con Rust via
`window.aero` (definido en `aero-tauri.js`).
