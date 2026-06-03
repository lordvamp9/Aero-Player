# Aero Player &#x22C6;&#x10659;&#x208A;&#x02DA;&#x2639;&#x2661;

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-30-47848F?logo=electron&logoColor=white)
![Licencia](https://img.shields.io/badge/Licencia-MIT-3C82FF)

Media player de escritorio con estetica Windows 7 Aero "Liquid Glass". Reproduce
tu musica local, videos de YouTube y canciones de Spotify desde una sola cola
unificada, acompanados de un visualizador de audio en tiempo real con cuatro
modos de animacion.

![Captura de pantalla](assets/screenshot.png)

---

## Instalacion rapida

Solo necesitas tener instalado [Node.js 20 o superior](https://nodejs.org). Despues,
abre una terminal en la carpeta del proyecto y ejecuta estos tres pasos:

```bash
git clone https://github.com/lordvamp9/Aero-Player.git
cd Aero-Player
npm install
```

Para abrir la aplicacion en modo desarrollo:

```bash
npm run dev
```

Para generar el instalador de Windows (MediaPlayer.exe):

```bash
npm run dist:win
```

El instalador queda en la carpeta `release/`. Eso es todo: la reproduccion de
musica local funciona sin configurar ninguna clave.

---

## Caracteristicas

Aero Player reune en una sola ventana tu musica local y dos plataformas en la
nube. La biblioteca local escanea carpetas completas de forma recursiva, lee los
metadatos ID3 de cada archivo (titulo, artista, album, genero, duracion y
caratula) y los organiza por album, artista o genero. YouTube se reproduce con
el reproductor oficial integrado y Spotify mediante su SDK de reproduccion web.

Todo se controla desde una cola unificada en la que conviven pistas de las tres
fuentes; puedes reordenarla arrastrando, agregar canciones soltando archivos
sobre la ventana y usar el menu contextual para gestionar cada pista. La interfaz
imita fielmente el cristal liquido de Windows 7 Aero, con reflejos, biseles,
sombras internas y la tipografia Segoe UI en peso light.

---

## Requisitos

- Node.js 20 o superior
- npm 10 o superior
- Windows, macOS o Linux (el instalador `.exe` se genera en Windows)

---

## Configuracion de credenciales

La musica local no necesita ninguna clave. YouTube y Spotify solo requieren
credenciales si quieres iniciar sesion y acceder a tus playlists personales.

1. Copia el archivo de ejemplo y renombralo a `.env`:

   ```bash
   copy .env.example .env      # en Windows
   cp .env.example .env        # en macOS / Linux
   ```

2. **Credenciales de Google / YouTube**
   - Entra en [Google Cloud Console](https://console.cloud.google.com).
   - Crea un proyecto y activa la **YouTube Data API v3**.
   - En "Credenciales" crea un **ID de cliente de OAuth 2.0** de tipo aplicacion
     de escritorio.
   - Agrega `http://localhost:3000/auth/google/callback` como URI de redireccion.
   - Copia el *Client ID* y el *Client Secret* dentro de tu `.env`.

3. **Credenciales de Spotify**
   - Entra en [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
   - Crea una aplicacion nueva.
   - Agrega `http://localhost:3000/auth/spotify/callback` como Redirect URI.
   - Copia el *Client ID* y el *Client Secret* dentro de tu `.env`.

El archivo `.env` nunca se sube al repositorio (ya esta excluido en
`.gitignore`). El archivo `.env.example` solo contiene marcadores de ejemplo.

---

## Desarrollo

| Comando | Descripcion |
|---|---|
| `npm run dev` | Inicia Vite y Electron con recarga en caliente. |
| `npm run build` | Genera el bundle estatico del renderer en `dist/`. |
| `npm run icon` | Regenera el icono `build/icon.ico` con estetica Aero. |
| `npm run dist:win` | Construye el instalador de Windows (MediaPlayer.exe). |

---

## Fuentes de audio soportadas

- **Archivos locales**: MP3, M4A, AAC, FLAC, WAV, OGG, OPUS y video MP4/WEBM/MKV/MOV.
- **YouTube**: reproduccion con la cuenta de Google a traves del reproductor oficial.
- **Spotify**: reproduccion con cuenta de Spotify; la reproduccion completa
  requiere una suscripcion Premium.

---

## Visualizadores

El area central muestra un visualizador de audio que reacciona al sonido real
mediante la Web Audio API. Incluye cuatro modos seleccionables en la esquina
inferior derecha:

1. **Ondas liquidas**: cinco capas de ondas superpuestas con particulas flotantes
   y un brillo radial. Es el modo por defecto.
2. **Espectro de frecuencias**: barras FFT con gradiente vertical, reflexion
   espejada e indicadores de pico con caida suave.
3. **Forma de onda**: tres capas de la senal de audio sobre un sutil tunel de luz.
4. **Particulas orbitales**: un sistema de particulas que se dispersa con la
   energia de los graves y cambia de color segun la frecuencia.

Cuando no hay audio en reproduccion, el visualizador funciona en un modo demo
animado para que el escenario nunca se vea estatico.

---

## Estructura del proyecto

```
aero-player/
├── src/
│   ├── main/        Proceso principal de Electron (IPC, escaneo, metadatos, OAuth)
│   └── renderer/    Interfaz (HTML, CSS Aero y logica en JavaScript)
├── build/           Recursos de empaquetado (icono)
├── electron-builder.config.js
├── vite.config.js
└── package.json
```

---

## Licencia

Distribuido bajo la licencia MIT.
