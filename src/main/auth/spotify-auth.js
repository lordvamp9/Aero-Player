'use strict'

// Flujo OAuth2 con PKCE para Spotify, identico en estructura al de Google.
// Lee credenciales desde process.env y guarda los tokens cifrados.
const http = require('http')
const crypto = require('crypto')
const { shell } = require('electron')
const { store } = require('../store')
const { successPage } = require('./google-auth')

const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize'
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'
const ME_ENDPOINT = 'https://api.spotify.com/v1/me'
const SCOPES = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'user-library-read',
  'streaming',
]

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function createPkce() {
  const verifier = base64url(crypto.randomBytes(48))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function getConfig() {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/auth/spotify/callback'
  if (!clientId || clientId === 'tu_api_aqui') {
    throw new Error('Configura SPOTIFY_CLIENT_ID en el archivo .env (copia .env.example).')
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
      res.end(successPage('Spotify'))
      server.close()
      if (error) reject(new Error(error))
      else if (code) resolve(code)
      else reject(new Error('No se recibio el codigo de autorizacion.'))
    })
    server.on('error', reject)
    server.listen(port)
    setTimeout(() => {
      server.close()
      reject(new Error('Tiempo de espera agotado para la autorizacion de Spotify.'))
    }, 180000)
  })
}

async function exchangeToken(params) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error('Error al intercambiar el token de Spotify: ' + text)
  }
  return res.json()
}

async function startSpotifyAuth() {
  const { clientId, redirectUri } = getConfig()
  const { verifier, challenge } = createPkce()

  const authUrl =
    AUTH_ENDPOINT +
    '?' +
    new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES.join(' '),
      code_challenge_method: 'S256',
      code_challenge: challenge,
    }).toString()

  await shell.openExternal(authUrl)
  const code = await waitForCode(redirectUri)

  const tokens = await exchangeToken({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })

  // Lee el perfil del usuario para mostrar su nombre.
  let userName = 'Cuenta de Spotify'
  try {
    const me = await fetch(ME_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).then((r) => r.json())
    userName = me.display_name || me.id || userName
  } catch {
    /* el nombre es opcional */
  }

  const session = {
    tokens,
    userName,
    expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
    connectedAt: Date.now(),
  }
  store.set('auth.spotify', session)
  return { connected: true, userName, accessToken: tokens.access_token }
}

function logoutSpotify() {
  store.set('auth.spotify', null)
  return { connected: false }
}

function getSpotifyStatus() {
  const s = store.get('auth.spotify')
  return s ? { connected: true, userName: s.userName } : { connected: false }
}

module.exports = { startSpotifyAuth, logoutSpotify, getSpotifyStatus }
