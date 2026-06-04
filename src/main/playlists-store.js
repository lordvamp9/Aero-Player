'use strict'

// Gestion persistente de playlists propias del usuario.
// Cada playlist tiene metadata + un array de tracks con su source.
const crypto = require('crypto')
const { store } = require('./store')

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'pl-' + Math.random().toString(36).slice(2)
}

function nowISO() {
  return new Date().toISOString()
}

function getAll() {
  return store.get('playlists') || []
}

function save(list) {
  store.set('playlists', list)
}

function getOne(id) {
  return getAll().find((p) => p.id === id) || null
}

function create({ name, coverPath = null, coverBase64 = null }) {
  if (!name || !name.trim()) return { ok: false, error: 'El nombre es obligatorio.' }
  const list = getAll()
  const pl = {
    id: uid(),
    name: name.trim(),
    coverPath,
    coverBase64,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    tracks: [],
  }
  list.push(pl)
  save(list)
  return { ok: true, playlist: pl }
}

function update(id, data) {
  const list = getAll()
  const idx = list.findIndex((p) => p.id === id)
  if (idx === -1) return { ok: false, error: 'Playlist no encontrada.' }
  if (typeof data.name === 'string' && data.name.trim()) list[idx].name = data.name.trim()
  if ('coverPath' in data) list[idx].coverPath = data.coverPath
  if ('coverBase64' in data) list[idx].coverBase64 = data.coverBase64
  list[idx].updatedAt = nowISO()
  save(list)
  return { ok: true, playlist: list[idx] }
}

function remove(id) {
  const list = getAll().filter((p) => p.id !== id)
  save(list)
  return { ok: true }
}

function normalizeTrack(track) {
  return {
    id: track.id || uid(),
    source: track.source,
    title: track.title,
    artist: track.artist || 'Artista desconocido',
    album: track.album || null,
    duration: track.duration || 0,
    durationFormatted: track.durationFormatted || '',
    coverUrl: track.coverUrl || null,
    spotifyUri: track.spotifyUri || null,
    spotifyId: track.spotifyId || null,
    videoId: track.videoId || null,
    filePath: track.filePath || null,
    addedAt: nowISO(),
  }
}

function trackKey(t) {
  return t.spotifyId || t.videoId || t.filePath || t.title
}

function addTrack(playlistId, track) {
  const list = getAll()
  const pl = list.find((p) => p.id === playlistId)
  if (!pl) return { ok: false, error: 'Playlist no encontrada.' }
  const key = trackKey(track)
  if (pl.tracks.some((t) => trackKey(t) === key)) {
    return { ok: true, playlist: pl, duplicate: true }
  }
  pl.tracks.push(normalizeTrack(track))
  pl.updatedAt = nowISO()
  save(list)
  return { ok: true, playlist: pl }
}

function addTracksBulk(playlistId, tracks) {
  const list = getAll()
  const pl = list.find((p) => p.id === playlistId)
  if (!pl) return { ok: false, error: 'Playlist no encontrada.' }
  const existing = new Set(pl.tracks.map(trackKey))
  let added = 0
  for (const t of tracks || []) {
    const key = trackKey(t)
    if (existing.has(key)) continue
    pl.tracks.push(normalizeTrack(t))
    existing.add(key)
    added++
  }
  pl.updatedAt = nowISO()
  save(list)
  return { ok: true, playlist: pl, added }
}

function removeTrack(playlistId, trackId) {
  const list = getAll()
  const pl = list.find((p) => p.id === playlistId)
  if (!pl) return { ok: false, error: 'Playlist no encontrada.' }
  pl.tracks = pl.tracks.filter((t) => t.id !== trackId)
  pl.updatedAt = nowISO()
  save(list)
  return { ok: true, playlist: pl }
}

function reorder(playlistId, fromIndex, toIndex) {
  const list = getAll()
  const pl = list.find((p) => p.id === playlistId)
  if (!pl) return { ok: false, error: 'Playlist no encontrada.' }
  if (fromIndex < 0 || fromIndex >= pl.tracks.length) return { ok: false, error: 'Indice invalido.' }
  const [t] = pl.tracks.splice(fromIndex, 1)
  pl.tracks.splice(Math.max(0, Math.min(toIndex, pl.tracks.length)), 0, t)
  pl.updatedAt = nowISO()
  save(list)
  return { ok: true, playlist: pl }
}

function moveTrackToEdge(playlistId, trackId, edge) {
  const list = getAll()
  const pl = list.find((p) => p.id === playlistId)
  if (!pl) return { ok: false, error: 'Playlist no encontrada.' }
  const idx = pl.tracks.findIndex((t) => t.id === trackId)
  if (idx === -1) return { ok: false, error: 'Track no encontrado.' }
  const [t] = pl.tracks.splice(idx, 1)
  if (edge === 'top') pl.tracks.unshift(t)
  else pl.tracks.push(t)
  pl.updatedAt = nowISO()
  save(list)
  return { ok: true, playlist: pl }
}

module.exports = {
  getAll,
  getOne,
  create,
  update,
  remove,
  addTrack,
  addTracksBulk,
  removeTrack,
  reorder,
  moveTrackToEdge,
}
