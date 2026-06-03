'use strict'

// Flujo OAuth2 con PKCE para Google / YouTube, sin servidor externo.
// 1. Genera code_verifier y code_challenge (S256).
// 2. Abre la URL de autorizacion en el navegador del sistema.
// 3. Levanta un servidor temporal en localhost:3000 para capturar el callback.
// 4. Intercambia el code por access_token y refresh_token.
// 5. Guarda los tokens cifrados con electron-store.
const http = require('http')
const crypto = require('crypto')
const { shell } = require('electron')
const { google } = require('googleapis')
const { store } = require('../store')

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly']

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function createPkce() {
  const verifier = base64url(crypto.randomBytes(48))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function getConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback'
  if (!clientId || clientId === 'tu_api_aqui') {
    throw new Error('Configura GOOGLE_CLIENT_ID en el archivo .env (copia .env.example).')
  }
  return { clientId, clientSecret, redirectUri }
}

function parseCallbackPort(redirectUri) {
  try {
    return Number(new URL(redirectUri).port) || 3000
  } catch {
    return 3000
  }
}

// Espera el redirect del navegador y devuelve el "code" capturado.
function waitForCode(redirectUri) {
  const port = parseCallbackPort(redirectUri)
  const callbackPath = new URL(redirectUri).pathname
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`)
      if (url.pathname !== callbackPath) {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(successPage('Google'))
      server.close()
      if (error) reject(new Error(error))
      else if (code) resolve(code)
      else reject(new Error('No se recibio el codigo de autorizacion.'))
    })
    server.on('error', reject)
    server.listen(port)
    setTimeout(() => {
      server.close()
      reject(new Error('Tiempo de espera agotado para la autorizacion de Google.'))
    }, 180000)
  })
}

async function startGoogleAuth() {
  const { clientId, clientSecret, redirectUri } = getConfig()
  const { verifier, challenge } = createPkce()

  const authUrl =
    AUTH_ENDPOINT +
    '?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    }).toString()

  await shell.openExternal(authUrl)
  const code = await waitForCode(redirectUri)

  // Intercambio del code por tokens.
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
  const { tokens } = await oauth2.getToken({ code, codeVerifier: verifier })
  oauth2.setCredentials(tokens)

  // Lee informacion basica del canal del usuario.
  let userName = 'Cuenta de YouTube'
  try {
    const yt = google.youtube({ version: 'v3', auth: oauth2 })
    const res = await yt.channels.list({ part: ['snippet'], mine: true })
    userName = res.data.items?.[0]?.snippet?.title || userName
  } catch {
    /* el nombre es opcional */
  }

  const session = { tokens, userName, connectedAt: Date.now() }
  store.set('auth.google', session)
  return { connected: true, userName }
}

function logoutGoogle() {
  store.set('auth.google', null)
  return { connected: false }
}

function getGoogleStatus() {
  const s = store.get('auth.google')
  return s ? { connected: true, userName: s.userName } : { connected: false }
}

function successPage(provider) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Aero Player</title>
  <style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
  background:#06122b;color:#cfe4ff;font-family:'Segoe UI',sans-serif;font-weight:300}
  .card{padding:40px 56px;border-radius:12px;background:linear-gradient(180deg,rgba(20,55,150,.3),rgba(5,18,70,.45));
  border:1px solid rgba(120,180,255,.25);box-shadow:0 8px 40px rgba(0,20,100,.5);text-align:center}
  h1{font-weight:300;font-size:22px;margin:0 0 8px}p{opacity:.8;margin:0}</style></head>
  <body><div class="card"><h1>Conexion con ${provider} completada</h1>
  <p>Ya puedes volver a Aero Player. Esta ventana se puede cerrar.</p></div></body></html>`
}

module.exports = { startGoogleAuth, logoutGoogle, getGoogleStatus, successPage }
