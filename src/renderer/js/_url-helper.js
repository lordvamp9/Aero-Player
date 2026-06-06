/* Pequeno helper: abre URLs en el navegador del sistema usando el plugin opener
   via el bridge window.aero. Si no esta disponible, hace fallback a window.open. */
export function openUrl(ctx, url) {
  try {
    if (ctx && ctx.aero && typeof ctx.aero.openExternal === 'function') {
      ctx.aero.openExternal(url)
      return
    }
  } catch {}
  try {
    window.open(url, '_blank', 'noopener')
  } catch {}
}
