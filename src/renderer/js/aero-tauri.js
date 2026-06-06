/* =====================================================================
   AERO PLAYER  ·  aero-tauri.js
   Puente window.aero para la version Tauri (WebView2). Reimplementa el
   mismo contrato que exponia preload.js de Electron, pero sobre los
   plugins de Tauri (store, fs, dialog, opener), comandos Rust nativos
   (scan_folder, read_metadata, oauth_listen) y fetch directo para las
   APIs de YouTube/Spotify. El renderer no nota la diferencia.

   Solo se activa bajo Tauri. En Electron, preload.js ya define window.aero
   y este modulo no hace nada.
   ===================================================================== */

import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { readFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'

// Credenciales inyectadas por Vite (define) desde el .env de la raiz.
const ENV = typeof __AERO_ENV__ !== 'undefined' ? __AERO_ENV__ : {}

if (window.__TAURI_INTERNALS__ && !window.aero) {
  // -------------------------------------------------------------------
  // Persistencia (plugin-store) con acceso por clave punteada (auth.spotify)
  // -------------------------------------------------------------------
  let store = null
  const cache = {
    config: { visualizerMode: 'liquid', volume: 0.8, lastFolders: [] },
    library: [],
    favorites: [],
    playlists: [],
    auth: { google: null, spotify: null },
  }

  const ready = (async () => {
    store = await Store.load('aero-player.json')
    for (const key of Object.keys(cache)) {
      try {
        const v = await store.get(key)
        if (v !== undefined && v !== null) cache[key] = v
      } catch {}
    }
  })()

  function dottedGet(key) {
    const parts = String(key).split('.')
    let cur = cache
    for (const p of parts) {
      if (cur == null) return undefined
      cur = cur[p]
    }
    return cur
  }

  async function dottedSet(key, value) {
    const parts = String(key).split('.')
    const top = parts[0]
    if (parts.length === 1) {
      cache[top] = value
    } else {
      if (cache[top] == null || typeof cache[top] !== 'object') cache[top] = {}
      let o = cache[top]
      for (let i = 1; i < parts.length - 1; i++) {
        if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {}
        o = o[parts[i]]
      }
      o[parts[parts.length - 1]] = value
    }
    await persist(top)
  }

  // Persiste una clave de nivel superior sin que un fallo de disco rompa la
  // operacion en memoria (la UI sigue funcionando aunque el guardado falle).
  async function persist(top) {
    try {
      await store.set(top, cache[top])
      await store.save()
    } catch (e) {
      console.warn('[aero-tauri] no se pudo guardar "' + top + '":', e)
    }
  }

  // -------------------------------------------------------------------
  // PKCE (Web Crypto)
  // -------------------------------------------------------------------
  function base64url(bytes) {
    let bin = ''
    const arr = new Uint8Array(bytes)
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i])
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  function randomVerifier() {
    const a = new Uint8Array(48)
    crypto.getRandomValues(a)
    return base64url(a)
  }
  async function challengeOf(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    return base64url(digest)
  }

  async function runOAuth({ authBase, params, redirectUri, provider, tokenExchange }) {
    const u = new URL(redirectUri)
    const port = Number(u.port) || 3000
    const path = u.pathname
    const verifier = randomVerifier()
    const challenge = await challengeOf(verifier)
    const authUrl =
      authBase +
      '?' +
      new URLSearchParams({ ...params, code_challenge: challenge, code_challenge_method: 'S256' }).toString()
    await openUrl(authUrl)
    const query = await invoke('oauth_listen', { port, path, provider })
    const sp = new URLSearchParams(query)
    const error = sp.get('error')
    if (error) throw new Error(error)
    const code = sp.get('code')
    if (!code) throw new Error('No se recibio el codigo de autorizacion.')
    return await tokenExchange(code, verifier)
  }

  // -------------------------------------------------------------------
  // Spotify: auth + token + Web API (puerto de spotify-api.js)
  // -------------------------------------------------------------------
  const SP_API = 'https://api.spotify.com/v1'

  async function spotifyAuthStart() {
    await ready
    const redirectUri = ENV.SPOTIFY_REDIRECT_URI
    const scopes = [
      'user-read-private', 'user-read-email', 'playlist-read-private',
      'playlist-read-collaborative', 'user-library-read',
      'user-read-playback-state', 'user-modify-playback-state', 'streaming',
    ]
    try {
      if (!ENV.SPOTIFY_CLIENT_ID) throw new Error('Configura SPOTIFY_CLIENT_ID en el archivo .env.')
      const tokens = await runOAuth({
        authBase: 'https://accounts.spotify.com/authorize',
        redirectUri, provider: 'Spotify',
        params: { client_id: ENV.SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri, scope: scopes.join(' ') },
        tokenExchange: async (code, verifier) => {
          const res = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: ENV.SPOTIFY_CLIENT_ID, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
          })
          if (!res.ok) throw new Error('Error al intercambiar token de Spotify: ' + (await res.text()))
          return res.json()
        },
      })
      let userName = 'Cuenta de Spotify'
      try {
        const me = await fetch(SP_API + '/me', { headers: { Authorization: 'Bearer ' + tokens.access_token } }).then((r) => r.json())
        userName = me.display_name || me.id || userName
      } catch {}
      // Spotify devuelve los scopes realmente otorgados en tokens.scope (string separado por espacios).
      // Los guardamos para poder detectar tokens viejos a los que les falta algun scope nuevo.
      const grantedScopes = (tokens.scope || '').split(/\s+/).filter(Boolean)
      const session = {
        tokens, userName,
        expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
        connectedAt: Date.now(),
        grantedScopes,
        requestedScopes: scopes,
      }
      await dottedSet('auth.spotify', session)
      return { connected: true, userName, accessToken: tokens.access_token }
    } catch (err) {
      return { connected: false, error: String((err && err.message) || err) }
    }
  }

  async function spotifyValidToken() {
    await ready
    const session = dottedGet('auth.spotify')
    if (!session || !session.tokens) return null
    if (Date.now() > (session.expiresAt || 0) - 60000 && session.tokens.refresh_token) {
      try {
        const res = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.tokens.refresh_token, client_id: ENV.SPOTIFY_CLIENT_ID }).toString(),
        })
        if (res.ok) {
          const data = await res.json()
          session.tokens.access_token = data.access_token
          if (data.refresh_token) session.tokens.refresh_token = data.refresh_token
          session.expiresAt = Date.now() + (data.expires_in || 3600) * 1000
          await dottedSet('auth.spotify', session)
          return data.access_token
        }
      } catch {}
    }
    return session.tokens.access_token
  }

  async function spGet(path) {
    const token = await spotifyValidToken()
    if (!token) return { ok: false, error: 'No autenticado', items: [] }
    const res = await fetch(SP_API + path, { headers: { Authorization: 'Bearer ' + token } })
    if (!res.ok) return { ok: false, error: `Spotify ${res.status}: ${await res.text()}`, items: [] }
    return { ok: true, data: await res.json() }
  }

  const spFmt = (ms) => {
    const s = Math.round((ms || 0) / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  const spArtists = (t) => (t.artists || []).map((a) => a.name).join(', ') || 'Artista desconocido'
  const spCover = (al) => {
    const imgs = (al && al.images) || []
    return (imgs[1] && imgs[1].url) || (imgs[0] && imgs[0].url) || null
  }
  function spMapTrack(t) {
    if (!t) return null
    return {
      id: 'sp-' + t.id, source: 'spotify', spotifyUri: t.uri, spotifyId: t.id,
      title: t.name, artist: spArtists(t), album: (t.album && t.album.name) || '',
      coverUrl: spCover(t.album), duration: Math.round((t.duration_ms || 0) / 1000),
      durationFormatted: spFmt(t.duration_ms),
    }
  }

  async function spotifyGetSavedTracks() {
    const r = await spGet('/me/tracks?limit=50')
    if (!r.ok) return r
    return { ok: true, items: (r.data.items || []).map((i) => spMapTrack(i.track)).filter(Boolean) }
  }
  async function spotifyGetPlaylists() {
    const r = await spGet('/me/playlists?limit=50')
    if (!r.ok) return r
    return {
      ok: true,
      items: (r.data.items || []).map((pl) => ({
        id: 'sppl-' + pl.id, playlistId: pl.id, kind: 'playlist', title: pl.name,
        owner: (pl.owner && pl.owner.display_name) || '', count: (pl.tracks && pl.tracks.total) || 0,
        coverUrl: (pl.images && pl.images[0] && pl.images[0].url) || null,
      })),
    }
  }
  async function spotifyGetSavedAlbums() {
    const r = await spGet('/me/albums?limit=50')
    if (!r.ok) return r
    return {
      ok: true,
      items: (r.data.items || []).map((i) => {
        const al = i.album
        return { id: 'spal-' + al.id, albumId: al.id, kind: 'album', title: al.name, owner: spArtists(al), count: al.total_tracks || 0, coverUrl: spCover(al) }
      }),
    }
  }
  async function spotifyGetPlaylistTracks(id) {
    const r = await spGet(`/playlists/${id}/tracks?limit=100`)
    if (!r.ok) return r
    return { ok: true, items: (r.data.items || []).map((i) => spMapTrack(i.track)).filter(Boolean) }
  }
  async function spotifyGetAlbumTracks(albumId) {
    const albumRes = await spGet(`/albums/${albumId}`)
    const cover = albumRes.ok ? spCover(albumRes.data) : null
    const albumName = albumRes.ok ? albumRes.data.name : ''
    const r = await spGet(`/albums/${albumId}/tracks?limit=50`)
    if (!r.ok) return r
    return {
      ok: true,
      items: (r.data.items || []).map((t) => ({
        id: 'sp-' + t.id, source: 'spotify', spotifyUri: t.uri, spotifyId: t.id, title: t.name,
        artist: spArtists(t), album: albumName, coverUrl: cover,
        duration: Math.round((t.duration_ms || 0) / 1000), durationFormatted: spFmt(t.duration_ms),
      })),
    }
  }
  async function spotifySearchTracks(query, limit = 10) {
    if (!query) return { ok: true, items: [] }
    const r = await spGet(`/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`)
    if (!r.ok) return r
    return { ok: true, items: ((r.data.tracks && r.data.tracks.items) || []).map(spMapTrack).filter(Boolean) }
  }
  async function spotifyGetAllPlaylistTracks(id) {
    let url = `/playlists/${id}/tracks?limit=100`
    const collected = []
    while (url) {
      const r = await spGet(url)
      if (!r.ok) return { ok: false, error: r.error, items: collected }
      ;(r.data.items || []).forEach((i) => { const t = spMapTrack(i.track); if (t) collected.push(t) })
      if (r.data.next) { const n = new URL(r.data.next); url = n.pathname.replace('/v1', '') + n.search } else url = null
    }
    return { ok: true, items: collected }
  }

  // -------------------------------------------------------------------
  // Google / YouTube: auth + token + Data API (puerto de youtube-api.js)
  // -------------------------------------------------------------------
  const YT_API = 'https://www.googleapis.com/youtube/v3'

  async function googleAuthStart() {
    await ready
    const redirectUri = ENV.GOOGLE_REDIRECT_URI
    try {
      if (!ENV.GOOGLE_CLIENT_ID) throw new Error('Configura GOOGLE_CLIENT_ID en el archivo .env.')
      const tokens = await runOAuth({
        authBase: 'https://accounts.google.com/o/oauth2/v2/auth',
        redirectUri, provider: 'Google',
        params: {
          client_id: ENV.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
          scope: 'https://www.googleapis.com/auth/youtube.readonly', access_type: 'offline', prompt: 'consent',
        },
        tokenExchange: async (code, verifier) => {
          const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: ENV.GOOGLE_CLIENT_ID, client_secret: ENV.GOOGLE_CLIENT_SECRET, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }).toString(),
          })
          if (!res.ok) throw new Error('Error al intercambiar token de Google: ' + (await res.text()))
          const d = await res.json()
          d.expiry_date = Date.now() + (d.expires_in || 3600) * 1000
          return d
        },
      })
      let userName = 'Cuenta de YouTube'
      try {
        const res = await fetch(YT_API + '/channels?part=snippet&mine=true', { headers: { Authorization: 'Bearer ' + tokens.access_token } }).then((r) => r.json())
        userName = (res.items && res.items[0] && res.items[0].snippet && res.items[0].snippet.title) || userName
      } catch {}
      const session = { tokens, userName, connectedAt: Date.now() }
      await dottedSet('auth.google', session)
      return { connected: true, userName }
    } catch (err) {
      return { connected: false, error: String((err && err.message) || err) }
    }
  }

  async function googleValidToken() {
    await ready
    const s = dottedGet('auth.google')
    if (!s || !s.tokens) return null
    const expiry = s.tokens.expiry_date || 0
    if (Date.now() > expiry - 60000 && s.tokens.refresh_token) {
      try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.tokens.refresh_token, client_id: ENV.GOOGLE_CLIENT_ID, client_secret: ENV.GOOGLE_CLIENT_SECRET }).toString(),
        })
        if (res.ok) {
          const d = await res.json()
          s.tokens.access_token = d.access_token
          s.tokens.expiry_date = Date.now() + (d.expires_in || 3600) * 1000
          await dottedSet('auth.google', s)
          return d.access_token
        }
      } catch {}
    }
    return s.tokens.access_token
  }

  async function ytGet(pathAndQuery) {
    const token = await googleValidToken()
    if (!token) return { ok: false, error: 'No autenticado', items: [] }
    const res = await fetch(YT_API + pathAndQuery, { headers: { Authorization: 'Bearer ' + token } })
    if (!res.ok) return { ok: false, error: `YouTube ${res.status}: ${await res.text()}`, items: [] }
    return { ok: true, data: await res.json() }
  }

  function ytParseDuration(iso) {
    if (!iso) return 0
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
    if (!m) return 0
    return parseInt(m[1] || 0) * 3600 + parseInt(m[2] || 0) * 60 + parseInt(m[3] || 0)
  }
  function ytFmt(sec) {
    if (!sec) return '0:00'
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }
  const ytThumb = (th) => (th && ((th.medium && th.medium.url) || (th.default && th.default.url))) || null

  async function ytEnrich(items) {
    const ids = items.map((i) => i.videoId).filter(Boolean)
    if (!ids.length) return items
    const r = await ytGet(`/videos?part=contentDetails&id=${ids.join(',')}`)
    if (!r.ok) return items
    const map = {}
    ;(r.data.items || []).forEach((v) => { map[v.id] = ytParseDuration(v.contentDetails && v.contentDetails.duration) })
    items.forEach((i) => { if (map[i.videoId] !== undefined) { i.duration = map[i.videoId]; i.durationFormatted = ytFmt(map[i.videoId]) } })
    return items
  }

  async function youtubeGetLiked() {
    const r = await ytGet('/playlistItems?part=snippet&playlistId=LL&maxResults=50')
    if (!r.ok) return r
    let items = (r.data.items || []).map((it) => ({
      id: 'yt-' + it.snippet.resourceId.videoId, source: 'youtube', videoId: it.snippet.resourceId.videoId,
      title: it.snippet.title, artist: it.snippet.videoOwnerChannelTitle || 'YouTube', album: 'Me gusta',
      coverUrl: ytThumb(it.snippet.thumbnails), duration: 0, durationFormatted: '',
    }))
    items = await ytEnrich(items)
    return { ok: true, items }
  }
  async function youtubeGetPlaylists() {
    const r = await ytGet('/playlists?part=snippet,contentDetails&mine=true&maxResults=50')
    if (!r.ok) return r
    return {
      ok: true,
      items: (r.data.items || []).map((pl) => ({
        id: 'ytpl-' + pl.id, playlistId: pl.id, title: pl.snippet.title, description: pl.snippet.description,
        count: (pl.contentDetails && pl.contentDetails.itemCount) || 0, coverUrl: ytThumb(pl.snippet.thumbnails), kind: 'playlist',
      })),
    }
  }
  async function youtubeGetPlaylistItems(playlistId) {
    const r = await ytGet(`/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50`)
    if (!r.ok) return r
    let items = (r.data.items || []).map((it) => ({
      id: 'yt-' + it.snippet.resourceId.videoId, source: 'youtube', videoId: it.snippet.resourceId.videoId,
      title: it.snippet.title, artist: it.snippet.videoOwnerChannelTitle || 'YouTube', album: it.snippet.playlistId,
      coverUrl: ytThumb(it.snippet.thumbnails), duration: 0, durationFormatted: '',
    }))
    items = await ytEnrich(items)
    return { ok: true, items }
  }
  async function youtubeSearchMusic(query) {
    const r = await ytGet(`/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=30`)
    if (!r.ok) return r
    let items = (r.data.items || []).map((it) => ({
      id: 'yt-' + it.id.videoId, source: 'youtube', videoId: it.id.videoId, title: it.snippet.title,
      artist: it.snippet.channelTitle, album: 'YouTube Musica', coverUrl: ytThumb(it.snippet.thumbnails), duration: 0, durationFormatted: '',
    }))
    items = await ytEnrich(items)
    return { ok: true, items }
  }
  async function youtubeGetAllPlaylistItems(playlistId) {
    const collected = []
    let pageToken = ''
    do {
      const r = await ytGet(`/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50${pageToken ? '&pageToken=' + pageToken : ''}`)
      if (!r.ok) return r.ok === false && collected.length === 0 ? r : { ok: true, items: collected }
      ;(r.data.items || []).forEach((it) => {
        const vid = it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId
        if (!vid) return
        collected.push({ id: 'yt-' + vid, source: 'youtube', videoId: vid, title: it.snippet.title, artist: it.snippet.videoOwnerChannelTitle || 'YouTube', album: '', coverUrl: ytThumb(it.snippet.thumbnails), duration: 0, durationFormatted: '' })
      })
      pageToken = r.data.nextPageToken || ''
    } while (pageToken)
    for (let i = 0; i < collected.length; i += 50) await ytEnrich(collected.slice(i, i + 50))
    return { ok: true, items: collected }
  }

  // -------------------------------------------------------------------
  // Playlists propias (puerto de playlists-store.js)
  // -------------------------------------------------------------------
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'pl-' + Math.random().toString(36).slice(2))
  const nowISO = () => new Date().toISOString()
  const plAll = () => cache.playlists || []
  async function plSave(list) { cache.playlists = list; await persist('playlists') }
  const trackKey = (t) => t.spotifyId || t.videoId || t.filePath || t.title
  function normalizeTrack(t) {
    return {
      id: t.id || uid(), source: t.source, title: t.title, artist: t.artist || 'Artista desconocido',
      album: t.album || null, duration: t.duration || 0, durationFormatted: t.durationFormatted || '',
      coverUrl: t.coverUrl || null, spotifyUri: t.spotifyUri || null, spotifyId: t.spotifyId || null,
      videoId: t.videoId || null, filePath: t.filePath || null, addedAt: nowISO(),
    }
  }

  const playlistsApi = {
    async getAll() { await ready; return plAll() },
    async create({ name, coverPath = null, coverBase64 = null } = {}) {
      await ready
      if (!name || !name.trim()) return { ok: false, error: 'El nombre es obligatorio.' }
      const list = plAll()
      const pl = { id: uid(), name: name.trim(), coverPath, coverBase64, createdAt: nowISO(), updatedAt: nowISO(), tracks: [] }
      list.push(pl); await plSave(list)
      return { ok: true, playlist: pl }
    },
    async update(id, data = {}) {
      await ready
      const list = plAll(); const idx = list.findIndex((p) => p.id === id)
      if (idx === -1) return { ok: false, error: 'Playlist no encontrada.' }
      if (typeof data.name === 'string' && data.name.trim()) list[idx].name = data.name.trim()
      if ('coverPath' in data) list[idx].coverPath = data.coverPath
      if ('coverBase64' in data) list[idx].coverBase64 = data.coverBase64
      list[idx].updatedAt = nowISO(); await plSave(list)
      return { ok: true, playlist: list[idx] }
    },
    async remove(id) { await ready; await plSave(plAll().filter((p) => p.id !== id)); return { ok: true } },
    async addTrack(playlistId, track) {
      await ready
      const list = plAll(); const pl = list.find((p) => p.id === playlistId)
      if (!pl) return { ok: false, error: 'Playlist no encontrada.' }
      const key = trackKey(track)
      if (pl.tracks.some((t) => trackKey(t) === key)) return { ok: true, playlist: pl, duplicate: true }
      pl.tracks.push(normalizeTrack(track)); pl.updatedAt = nowISO(); await plSave(list)
      return { ok: true, playlist: pl }
    },
    async addTracksBulk(playlistId, tracks) {
      await ready
      const list = plAll(); const pl = list.find((p) => p.id === playlistId)
      if (!pl) return { ok: false, error: 'Playlist no encontrada.' }
      const existing = new Set(pl.tracks.map(trackKey)); let added = 0
      for (const t of tracks || []) { const k = trackKey(t); if (existing.has(k)) continue; pl.tracks.push(normalizeTrack(t)); existing.add(k); added++ }
      pl.updatedAt = nowISO(); await plSave(list)
      return { ok: true, playlist: pl, added }
    },
    async removeTrack(playlistId, trackId) {
      await ready
      const list = plAll(); const pl = list.find((p) => p.id === playlistId)
      if (!pl) return { ok: false, error: 'Playlist no encontrada.' }
      pl.tracks = pl.tracks.filter((t) => t.id !== trackId); pl.updatedAt = nowISO(); await plSave(list)
      return { ok: true, playlist: pl }
    },
    async reorder(playlistId, fromIndex, toIndex) {
      await ready
      const list = plAll(); const pl = list.find((p) => p.id === playlistId)
      if (!pl) return { ok: false, error: 'Playlist no encontrada.' }
      if (fromIndex < 0 || fromIndex >= pl.tracks.length) return { ok: false, error: 'Indice invalido.' }
      const [t] = pl.tracks.splice(fromIndex, 1)
      pl.tracks.splice(Math.max(0, Math.min(toIndex, pl.tracks.length)), 0, t)
      pl.updatedAt = nowISO(); await plSave(list)
      return { ok: true, playlist: pl }
    },
    async moveTrackToEdge(playlistId, trackId, edge) {
      await ready
      const list = plAll(); const pl = list.find((p) => p.id === playlistId)
      if (!pl) return { ok: false, error: 'Playlist no encontrada.' }
      const idx = pl.tracks.findIndex((t) => t.id === trackId)
      if (idx === -1) return { ok: false, error: 'Track no encontrado.' }
      const [t] = pl.tracks.splice(idx, 1)
      if (edge === 'top') pl.tracks.unshift(t); else pl.tracks.push(t)
      pl.updatedAt = nowISO(); await plSave(list)
      return { ok: true, playlist: pl }
    },
  }

  // -------------------------------------------------------------------
  // Utilidades varias
  // -------------------------------------------------------------------
  function bytesToBase64(bytes) {
    let bin = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
    return btoa(bin)
  }

  const appWindow = getCurrentWindow()

  // -------------------------------------------------------------------
  // Contrato window.aero (identico al de preload.js)
  // -------------------------------------------------------------------
  window.aero = {
    // Biblioteca local (comandos Rust nativos)
    scanFolder: async (folderPath) => {
      try { return { ok: true, files: await invoke('scan_folder', { folder: folderPath }) } }
      catch (err) { return { ok: false, error: String((err && err.message) || err), files: [] } }
    },
    readMetadata: (filePath) => invoke('read_metadata', { path: filePath }),
    openFolderDialog: async () => {
      const folder = await openDialog({ directory: true, title: 'Selecciona una carpeta de musica' })
      return folder ? { canceled: false, folderPath: folder } : { canceled: true }
    },
    toMediaUrl: (filePath) => convertFileSrc(filePath),

    // Autenticacion
    googleAuthStart,
    googleAuthLogout: async () => { await dottedSet('auth.google', null); return { connected: false } },
    spotifyAuthStart,
    spotifyAuthLogout: async () => { await dottedSet('auth.spotify', null); return { connected: false } },
    getAuthStatus: async () => {
      await ready
      const g = dottedGet('auth.google'); const s = dottedGet('auth.spotify')
      return {
        google: g && g.tokens ? { connected: true, userName: g.userName } : { connected: false },
        spotify: s && s.tokens ? { connected: true, userName: s.userName } : { connected: false },
      }
    },

    // YouTube Data API
    youtubeGetLiked, youtubeGetPlaylists, youtubeGetPlaylistItems, youtubeSearchMusic, youtubeGetAllPlaylistItems,

    // Spotify Web API
    spotifyGetToken: spotifyValidToken,
    spotifyGetSavedTracks, spotifyGetPlaylists, spotifyGetSavedAlbums,
    spotifyGetPlaylistTracks, spotifyGetAllPlaylistTracks, spotifyGetAlbumTracks, spotifySearchTracks,
    // Devuelve los scopes que la sesion actual NO tiene aunque deberia.
    // Util para detectar tokens viejos que se quedaron sin permisos nuevos.
    spotifyMissingScopes: async () => {
      await ready
      const s = dottedGet('auth.spotify')
      if (!s || !s.tokens) return { ok: true, missing: [] }
      const required = [
        'playlist-read-private', 'playlist-read-collaborative',
        'user-library-read', 'user-read-private',
      ]
      const granted = s.grantedScopes || []
      const missing = required.filter((sc) => !granted.includes(sc))
      return { ok: true, missing, granted, hasGrantedField: !!s.grantedScopes }
    },

    // Playlists propias
    playlistsGetAll: () => playlistsApi.getAll(),
    playlistsCreate: (data) => playlistsApi.create(data || {}),
    playlistsUpdate: (id, data) => playlistsApi.update(id, data || {}),
    playlistsDelete: (id) => playlistsApi.remove(id),
    playlistsAddTrack: (id, track) => playlistsApi.addTrack(id, track),
    playlistsAddBulk: (id, tracks) => playlistsApi.addTracksBulk(id, tracks),
    playlistsRemoveTrack: (id, trackId) => playlistsApi.removeTrack(id, trackId),
    playlistsReorder: (id, from, to) => playlistsApi.reorder(id, from, to),
    playlistsMoveEdge: (id, trackId, edge) => playlistsApi.moveTrackToEdge(id, trackId, edge),
    openImageDialog: async () => {
      const file = await openDialog({ title: 'Selecciona una imagen de portada', filters: [{ name: 'Imagenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] })
      if (!file) return { canceled: true }
      try {
        const bytes = await readFile(file)
        const ext = file.split('.').pop().toLowerCase()
        const mime = ext === 'jpg' ? 'jpeg' : ext
        return { canceled: false, path: file, base64: `data:image/${mime};base64,${bytesToBase64(bytes)}` }
      } catch (err) { return { canceled: false, error: String((err && err.message) || err) } }
    },

    // Persistencia
    storeGet: async (key) => { await ready; return dottedGet(key) },
    storeSet: async (key, value) => { await ready; await dottedSet(key, value); return true },

    // Widevine: en WebView2 esta disponible nativamente.
    getWidevineStatus: async () => ({ ready: true, error: null }),

    // Controles de ventana
    windowMinimize: () => appWindow.minimize(),
    windowMaximize: () => appWindow.toggleMaximize(),
    windowClose: () => appWindow.close(),
    onMaximizeChange: (cb) => { appWindow.onResized(async () => { try { cb(await appWindow.isMaximized()) } catch {} }) },

    // Discord Rich Presence (los errores se ignoran: si Discord no esta abierto no pasa nada).
    discordInit: async (clientId) => {
      try { await invoke('discord_init', { clientId }); return { ok: true } }
      catch (e) { return { ok: false, error: String(e) } }
    },
    discordUpdate: async (payload) => {
      try { await invoke('discord_update', { payload }); return { ok: true } }
      catch (e) { return { ok: false, error: String(e) } }
    },
    discordClear: async () => {
      try { await invoke('discord_clear'); return { ok: true } }
      catch (e) { return { ok: false, error: String(e) } }
    },
    discordDisconnect: async () => {
      try { await invoke('discord_disconnect'); return { ok: true } }
      catch (e) { return { ok: false, error: String(e) } }
    },
  }
}
