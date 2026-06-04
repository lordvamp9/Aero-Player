// Configuracion de empaquetado. Genera MediaPlayer Setup mediante NSIS y
// utiliza build/icon.ico (multi-resolucion) para que el icono Aero aparezca
// nitido en el instalador, el .exe, el acceso directo, la taskbar y el alt-tab.
module.exports = {
  appId: 'com.aeroplayer.app',
  productName: 'MediaPlayer',
  copyright: 'Copyright 2024 Aero Player',
  directories: { output: 'release', buildResources: 'build' },
  // Usa el binario de Electron ya instalado en node_modules en lugar de
  // descargarlo. Necesario porque este proyecto usa el fork de castlabs
  // (Widevine), cuyos artefactos no están en el mirror público de Electron.
  electronDist: 'node_modules/electron/dist',
  electronVersion: '30.5.1',
  asar: false,
  // El .env NO se incluye en el bundle: cada usuario debe configurar sus
  // credenciales de Google/Spotify desde su propia instalacion para que no
  // se filtren credenciales del compilador.
  files: ['dist/**/*', 'src/main/**/*', 'package.json'],
  artifactName: 'MediaPlayer-Setup-${version}.${ext}',
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    executableName: 'MediaPlayer',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    installerHeaderIcon: 'build/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'MediaPlayer',
    uninstallDisplayName: 'MediaPlayer',
  },
  mac: {
    target: 'dmg',
    icon: 'build/icon.png',
    category: 'public.app-category.music',
  },
  linux: {
    target: 'AppImage',
    icon: 'build/icon.png',
    category: 'AudioVideo',
  },
}
