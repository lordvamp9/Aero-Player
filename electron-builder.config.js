// Configuracion de empaquetado. Genera MediaPlayer.exe mediante NSIS.
module.exports = {
  appId: 'com.aeroplayer.app',
  productName: 'MediaPlayer',
  copyright: 'Copyright 2024 Aero Player',
  directories: { output: 'release', buildResources: 'build' },
  files: ['dist/**/*', 'src/main/**/*', 'package.json'],
  asarUnpack: ['**/*.node'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    executableName: 'MediaPlayer',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    installerHeaderIcon: 'build/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'MediaPlayer',
  },
  mac: {
    target: 'dmg',
    icon: 'build/icon.icns',
    category: 'public.app-category.music',
  },
  linux: {
    target: 'AppImage',
    icon: 'build/icon.png',
    category: 'AudioVideo',
  },
}
