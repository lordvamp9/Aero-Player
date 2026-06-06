; =====================================================================
;  Aero Player - hooks NSIS
;
;  POSTUNINSTALL: borra restos en %APPDATA% y %LOCALAPPDATA% para que
;  el desinstalador no deje rastro alguno. Incluye:
;    - %APPDATA%\com.aero.player (plugin-store)
;    - %LOCALAPPDATA%\com.aero.player (WebView2 cache, cookies, EME data)
;    - %APPDATA%\Aero Player (por si Tauri usa el productName)
;    - %LOCALAPPDATA%\Aero Player
;  Todo /r (recursivo) y silencioso. Si las carpetas no existen NSIS lo ignora.
; =====================================================================

!macro NSIS_HOOK_POSTUNINSTALL
  DetailPrint "Limpiando datos de Aero Player en AppData..."
  RMDir /r /REBOOTOK "$APPDATA\com.aero.player"
  RMDir /r /REBOOTOK "$LOCALAPPDATA\com.aero.player"
  RMDir /r /REBOOTOK "$APPDATA\Aero Player"
  RMDir /r /REBOOTOK "$LOCALAPPDATA\Aero Player"
  RMDir /r /REBOOTOK "$LOCALAPPDATA\Microsoft\EdgeWebView\UserData\com.aero.player"
  DetailPrint "Limpieza completa."
!macroend
