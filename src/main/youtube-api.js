'use strict'

// Llamadas reales a la YouTube Data API v3 usando los tokens guardados.
// Se ejecuta en el proceso principal donde estan las credenciales y el store.
const { google } = require('googleapis')
const { store } = require('./store')

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback'
  const session = store.get('auth.google')
  if (!session || !session.tokens) return null
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
  oauth2.setCredentials(session.tokens)
  return oauth2
}

// Devuelve una instancia del cliente de YouTube ya autenticado.
function getYouTube() {
  const auth = getOAuth2Client()
  if (!auth) return null
  return google.youtube({ version: 'v3', auth })
}

// Convierte una ISO 8601 duration (PT4M13S) en segundos.
function parseDuration(iso) {
  if (!iso) return 0
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0)
}

function fmt(sec) {
  if (!sec) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${m}:${String(s).padStart(2,'0')}`
}

// Obtiene los IDs de duracion de hasta 50 videos de una vez.
async function enrichWithDuration(yt, items) {
  const ids = items.map(i => i.videoId).filter(Boolean)
  if (!ids.length) return items
  try {
    const res = await yt.videos.list({ part: ['contentDetails'], id: ids.join(',') })
    const map = {}
    ;(res.data.items || []).forEach(v => {
      map[v.id] = parseDuration(v.contentDetails?.duration)
    })
    items.forEach(i => {
      if (map[i.videoId] !== undefined) {
        i.duration = map[i.videoId]
        i.durationFormatted = fmt(map[i.videoId])
      }
    })
  } catch { /* duracion opcional */ }
  return items
}

// ---- Videos con "Me gusta" ----
async function getLikedVideos(maxResults = 50) {
  const yt = getYouTube()
  if (!yt) return { ok: false, error: 'No autenticado', items: [] }
  try {
    const res = await yt.playlistItems.list({
      part: ['snippet'],
      playlistId: 'LL', // Liked Videos
      maxResults,
    })
    let items = (res.data.items || []).map(item => ({
      id: 'yt-' + item.snippet.resourceId.videoId,
      source: 'youtube',
      videoId: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      artist: item.snippet.videoOwnerChannelTitle || 'YouTube',
      album: 'Me gusta',
      coverUrl: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
      duration: 0,
      durationFormatted: '',
    }))
    items = await enrichWithDuration(yt, items)
    return { ok: true, items }
  } catch (err) {
    return { ok: false, error: String(err.message || err), items: [] }
  }
}

// ---- Playlists del usuario ----
async function getMyPlaylists(maxResults = 50) {
  const yt = getYouTube()
  if (!yt) return { ok: false, error: 'No autenticado', items: [] }
  try {
    const res = await yt.playlists.list({
      part: ['snippet', 'contentDetails'],
      mine: true,
      maxResults,
    })
    const items = (res.data.items || []).map(pl => ({
      id: 'ytpl-' + pl.id,
      playlistId: pl.id,
      title: pl.snippet.title,
      description: pl.snippet.description,
      count: pl.contentDetails?.itemCount || 0,
      coverUrl: pl.snippet.thumbnails?.medium?.url || pl.snippet.thumbnails?.default?.url || null,
      kind: 'playlist',
    }))
    return { ok: true, items }
  } catch (err) {
    return { ok: false, error: String(err.message || err), items: [] }
  }
}

// ---- Videos de una playlist ----
async function getPlaylistItems(playlistId, maxResults = 50) {
  const yt = getYouTube()
  if (!yt) return { ok: false, error: 'No autenticado', items: [] }
  try {
    const res = await yt.playlistItems.list({
      part: ['snippet'],
      playlistId,
      maxResults,
    })
    let items = (res.data.items || []).map(item => ({
      id: 'yt-' + item.snippet.resourceId.videoId,
      source: 'youtube',
      videoId: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      artist: item.snippet.videoOwnerChannelTitle || 'YouTube',
      album: item.snippet.playlistId,
      coverUrl: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
      duration: 0,
      durationFormatted: '',
    }))
    items = await enrichWithDuration(yt, items)
    return { ok: true, items }
  } catch (err) {
    return { ok: false, error: String(err.message || err), items: [] }
  }
}

// ---- Busqueda de musica en YouTube ----
async function searchMusic(query, maxResults = 30) {
  const yt = getYouTube()
  if (!yt) return { ok: false, error: 'No autenticado', items: [] }
  try {
    const res = await yt.search.list({
      part: ['snippet'],
      q: query,
      type: ['video'],
      videoCategoryId: '10', // Musica
      maxResults,
    })
    let items = (res.data.items || []).map(item => ({
      id: 'yt-' + item.id.videoId,
      source: 'youtube',
      videoId: item.id.videoId,
      title: item.snippet.title,
      artist: item.snippet.channelTitle,
      album: 'YouTube Musica',
      coverUrl: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
      duration: 0,
      durationFormatted: '',
    }))
    items = await enrichWithDuration(yt, items)
    return { ok: true, items }
  } catch (err) {
    return { ok: false, error: String(err.message || err), items: [] }
  }
}

// ---- Todos los items de una playlist (paginacion completa) ----
async function getAllPlaylistItems(playlistId) {
  const yt = getYouTube()
  if (!yt) return { ok: false, error: 'No autenticado', items: [] }
  try {
    const collected = []
    let pageToken = undefined
    do {
      const res = await yt.playlistItems.list({
        part: ['snippet'],
        playlistId,
        maxResults: 50,
        pageToken,
      })
      ;(res.data.items || []).forEach((item) => {
        const vid = item.snippet?.resourceId?.videoId
        if (!vid) return
        collected.push({
          id: 'yt-' + vid,
          source: 'youtube',
          videoId: vid,
          title: item.snippet.title,
          artist: item.snippet.videoOwnerChannelTitle || 'YouTube',
          album: '',
          coverUrl: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || null,
          duration: 0,
          durationFormatted: '',
        })
      })
      pageToken = res.data.nextPageToken || undefined
    } while (pageToken)

    // Enriquece duraciones en lotes de 50.
    for (let i = 0; i < collected.length; i += 50) {
      await enrichWithDuration(yt, collected.slice(i, i + 50))
    }
    return { ok: true, items: collected }
  } catch (err) {
    return { ok: false, error: String(err.message || err), items: [] }
  }
}

module.exports = { getLikedVideos, getMyPlaylists, getPlaylistItems, getAllPlaylistItems, searchMusic }
