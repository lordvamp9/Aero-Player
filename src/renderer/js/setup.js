/* =====================================================================
   AERO PLAYER  ·  setup.js
   Wizard de primera ejecucion. Muestra un overlay glass que pide las
   credenciales OAuth de Google y Spotify, con enlaces directos a los
   dashboards y validacion en vivo. Se cierra al guardar y la app
   continua con la configuracion aplicada en caliente (sin reiniciar).
   ===================================================================== */

import { openUrl } from './_url-helper.js'

export async function maybeShowSetup(ctx) {
  if (!ctx.aero || !ctx.aero.getAppConfig) return false
  const cfg = await ctx.aero.getAppConfig()
  if (cfg.isConfigured) return false
  await showSetup(ctx, cfg, { firstRun: true })
  return true
}

export async function showSetup(ctx, initial = null, opts = {}) {
  const cfg = initial || (await ctx.aero.getAppConfig())
  return new Promise((resolve) => {
    const overlay = buildOverlay(cfg, opts)
    document.body.appendChild(overlay)

    overlay.querySelector('.setup-skip').addEventListener('click', () => {
      overlay.remove()
      resolve({ skipped: true })
    })

    overlay.querySelector('.setup-save').addEventListener('click', async () => {
      const next = readForm(overlay)
      const err = validate(next)
      if (err) {
        showInline(overlay, err)
        return
      }
      const btn = overlay.querySelector('.setup-save')
      btn.disabled = true
      btn.textContent = 'Guardando...'
      try {
        await ctx.aero.setAppConfig(next)
        ctx.toast && ctx.toast('Configuracion guardada. Ya podes conectar tus cuentas.')
        overlay.remove()
        resolve({ saved: true, config: next })
      } catch (e) {
        btn.disabled = false
        btn.textContent = 'Guardar y continuar'
        showInline(overlay, 'No se pudo guardar: ' + (e.message || e))
      }
    })

    overlay.querySelectorAll('[data-openurl]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault()
        openUrl(ctx, a.dataset.openurl)
      })
    })
  })
}

function buildOverlay(cfg, opts) {
  const div = document.createElement('div')
  div.className = 'setup-overlay'
  div.innerHTML = `
    <div class="setup-card glass-panel">
      <div class="setup-header">
        <h2 class="setup-title">${opts.firstRun ? 'Bienvenido a Aero Player' : 'Configuracion de credenciales'}</h2>
        <p class="setup-subtitle">${opts.firstRun
          ? 'Para reproducir musica de YouTube o Spotify necesitas credenciales gratuitas de cada plataforma. Configuralas una vez y queda guardado para siempre.'
          : 'Modifica tus credenciales OAuth de Google y Spotify.'}</p>
      </div>

      <!-- Spotify -->
      <section class="setup-section">
        <h3 class="setup-section-title">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#1db954"><circle cx="12" cy="12" r="11"/></svg>
          Spotify
        </h3>
        <ol class="setup-steps">
          <li>Entra a <a href="#" data-openurl="https://developer.spotify.com/dashboard">Spotify Developer Dashboard</a> e inicia sesion.</li>
          <li>Click en <strong>Create app</strong>. Nombre y descripcion los que quieras.</li>
          <li>En <strong>Redirect URIs</strong> pega: <code>http://127.0.0.1:3000/auth/spotify/callback</code></li>
          <li>Click en <strong>Save</strong>. Despues entra a tu app -> <strong>Settings</strong> y copia el <strong>Client ID</strong>.</li>
        </ol>
        <div class="setup-field">
          <label>Client ID</label>
          <input type="text" name="SPOTIFY_CLIENT_ID" placeholder="abc123def456..." value="${escapeAttr(cfg.SPOTIFY_CLIENT_ID)}" />
        </div>
      </section>

      <!-- Google -->
      <section class="setup-section">
        <h3 class="setup-section-title">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#ff0033"><path d="M12 2a10 10 0 1 0 10 10h-9v3.5h5.5a6.5 6.5 0 1 1-1.9-5.4l2.5-2.5A10 10 0 0 0 12 2z"/></svg>
          YouTube (Google)
        </h3>
        <ol class="setup-steps">
          <li>Entra a <a href="#" data-openurl="https://console.cloud.google.com/apis/credentials">Google Cloud Console - Credenciales</a> y crea un proyecto.</li>
          <li>Activa la <strong>YouTube Data API v3</strong> en <a href="#" data-openurl="https://console.cloud.google.com/apis/library/youtube.googleapis.com">esta pagina</a>.</li>
          <li>En <strong>Credenciales</strong> -> <strong>Crear credenciales</strong> -> <strong>ID de cliente de OAuth 2.0</strong>.</li>
          <li>Tipo: <strong>Aplicacion de escritorio</strong>. URI de redireccion autorizado: <code>http://127.0.0.1:3000/auth/google/callback</code></li>
          <li>Descarga el JSON o copia el <strong>Client ID</strong> y <strong>Client Secret</strong> que te muestra.</li>
        </ol>
        <div class="setup-field">
          <label>Client ID</label>
          <input type="text" name="GOOGLE_CLIENT_ID" placeholder="123456-abc.apps.googleusercontent.com" value="${escapeAttr(cfg.GOOGLE_CLIENT_ID)}" />
        </div>
        <div class="setup-field">
          <label>Client Secret</label>
          <input type="password" name="GOOGLE_CLIENT_SECRET" placeholder="GOCSPX-..." value="${escapeAttr(cfg.GOOGLE_CLIENT_SECRET)}" />
        </div>
      </section>

      <div class="setup-error" hidden></div>

      <footer class="setup-footer">
        ${opts.firstRun ? '<button class="setup-skip">Configurar despues</button>' : '<button class="setup-skip">Cancelar</button>'}
        <button class="setup-save connect-btn connect-sp">Guardar y continuar</button>
      </footer>

      <p class="setup-note">
        Estas claves se guardan localmente en tu PC, encriptadas por el sistema. Nunca se envian a ningun servidor de Aero Player.
        Podes cambiarlas en cualquier momento desde <strong>Ajustes -> Configuracion inicial</strong>.
      </p>
    </div>
  `
  return div
}

function readForm(overlay) {
  const next = {}
  overlay.querySelectorAll('input[name]').forEach((i) => { next[i.name] = i.value.trim() })
  return next
}

function validate(v) {
  if (!v.SPOTIFY_CLIENT_ID && !v.GOOGLE_CLIENT_ID) {
    return 'Tenes que configurar al menos una de las dos plataformas (Spotify o Google).'
  }
  if (v.GOOGLE_CLIENT_ID && !v.GOOGLE_CLIENT_SECRET) {
    return 'Google requiere Client ID y Client Secret. Pegaselos ambos.'
  }
  return null
}

function showInline(overlay, msg) {
  const box = overlay.querySelector('.setup-error')
  box.textContent = msg
  box.hidden = false
}

function escapeAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
