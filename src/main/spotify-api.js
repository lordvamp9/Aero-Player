'use strict'

// Llamadas a la Spotify Web API usando los tokens guardados, con refresco
// automatico del access_token cuando expira (flujo PKCE, sin secret).
const { store } = require('./store')

const API = 'https://api.spotify.com/v1'
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'

async function refreshAccessToken(session) {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.tokens.refresh_token,
      client_id: clientId,
    }).toString(),
  })
  if (!res.ok) throw new Error('No se pudo refrescar el token de Spotify')
  const data = await res.json()
  session.tokens.access_token = data.access_token
  if (data.refresh_token) session.tokens.refresh_token = data.refresh_token
  session.expiresAt = Date.now() + (data.expires_in || 3600) * 1000
  store.set('auth.spotify', session)
  return data.access_token
}

// Devuelve un access_token valido, refrescandolo si esta por expirar.
async function getValidToken() {
  const session = store.get('auth.spotify')
  if (!session || !session.tokens) return null
  if (Date.now() > (session.expiresAt || 0) - 60000 && session.tokens.refresh_token) {
    try {
      return await refreshAccessToken(session)
    } catch {
      return session.tokens.access_token
    }
  }
  return session.tokens.access_token
}

async function apiGet(path) {
  const token = await getValidToken()
  if (!token) return { ok: false, error: 'No autenticado', items: [] }
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `Spotify ${res.status}: ${text}`, items: [] }
  }
  return { ok: true, data: await res.json() }
}

function fmt(ms) {
  const s = Math.round((ms || 0) / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function artistsOf(track) {
  return (track.artists || []).map((a) => a.name).join(', ') || 'Artista desconocido'
}

function coverOf(album) {
  const imgs = (album && album.images) || []
  return imgs[1]?.url || imgs[0]?.url || null
}

function mapTrack(track) {
  if (!track) return null
  return {
    id: 'sp-' + track.id,
    source: 'spotify',
    spotifyUri: track.uri,
    spotifyId: track.id,
    title: track.name,
    artist: artistsOf(track),
    album: track.album?.name || '',
    coverUrl: coverOf(track.album),
    duration: Math.round((track.duration_ms || 0) / 1000),
    durationFormatted: fmt(track.duration_ms),
  }
}

// ---- Canciones guardadas ----
async function getSavedTracks() {
  const r = await apiGet('/me/tracks?limit=50')
  if (!r.ok) return r
  const items = (r.data.items || []).map((i) => mapTrack(i.track)).filter(Boolean)
  return { ok: true, items }
}

// ---- Playlists del usuario ----
async function getPlaylists() {
  const r = await apiGet('/me/playlists?limit=50')
  if (!r.ok) return r
  const items = (r.data.items || []).map((pl) => ({
    id: 'sppl-' + pl.id,
    playlistId: pl.id,
    kind: 'playlist',
    title: pl.name,
    owner: pl.owner?.display_name || '',
    count: pl.tracks?.total || 0,
    coverUrl: (pl.images && (pl.images[0]?.url || null)) || null,
  }))
  return { ok: true, items }
}

// ---- Albumes guardados ----
async function getSavedAlbums() {
  const r = await apiGet('/me/albums?limit=50')
  if (!r.ok) return r
  const items = (r.data.items || []).map((i) => {
    const al = i.album
    return {
      id: 'spal-' + al.id,
      albumId: al.id,
      kind: 'album',
      title: al.name,
      owner: artistsOf(al),
      count: al.total_tracks || 0,
      coverUrl: coverOf(al),
    }
  })
  return { ok: true, items }
}

// ---- Tracks de una playlist ----
async function getPlaylistTracks(playlistId) {
  const r = await apiGet(`/playlists/${playlistId}/tracks?limit=100`)
  if (!r.ok) return r
  const items = (r.data.items || []).map((i) => mapTrack(i.track)).filter(Boolean)
  return { ok: true, items }
}

// ---- Tracks de un album ----
async function getAlbumTracks(albumId) {
  // Primero el album para tener la caratula compartida.
  const albumRes = await apiGet(`/albums/${albumId}`)
  const cover = albumRes.ok ? coverOf(albumRes.data) : null
  const albumName = albumRes.ok ? albumRes.data.name : ''
  const r = await apiGet(`/albums/${albumId}/tracks?limit=50`)
  if (!r.ok) return r
  const items = (r.data.items || []).map((t) => ({
    id: 'sp-' + t.id,
    source: 'spotify',
    spotifyUri: t.uri,
    spotifyId: t.id,
    title: t.name,
    artist: artistsOf(t),
    album: albumName,
    coverUrl: cover,
    duration: Math.round((t.duration_ms || 0) / 1000),
    durationFormatted: fmt(t.duration_ms),
  }))
  return { ok: true, items }
}

// ---- Busqueda de tracks ----
async function searchTracks(query, limit = 10) {
  if (!query) return { ok: true, items: [] }
  const r = await apiGet(`/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`)
  if (!r.ok) return r
  const items = (r.data.tracks?.items || []).map(mapTrack).filter(Boolean)
  return { ok: true, items }
}

// ---- Paginacion completa de tracks de una playlist ----
async function getAllPlaylistTracks(playlistId) {
  let url = `/playlists/${playlistId}/tracks?limit=100`
  const collected = []
  while (url) {
    const r = await apiGet(url)
    if (!r.ok) return { ok: false, error: r.error, items: collected }
    ;(r.data.items || []).forEach((i) => {
      const t = mapTrack(i.track)
      if (t) collected.push(t)
    })
    // El "next" viene como URL completa; lo recortamos.
    if (r.data.next) {
      const next = new URL(r.data.next)
      url = next.pathname.replace('/v1', '') + next.search
    } else {
      url = null
    }
  }
  return { ok: true, items: collected }
}

module.exports = {
  getValidToken,
  getSavedTracks,
  getPlaylists,
  getSavedAlbums,
  getPlaylistTracks,
  getAllPlaylistTracks,
  getAlbumTracks,
  searchTracks,
}
