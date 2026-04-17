import { supabase } from './supabase'

export const SUGGEST_STORE = 'pt_tracker_suggestions_v1'
export const GALLERY_STORE = 'pt_tracker_gallery_v1'

// ── Suggestions via Supabase ──────────────────────────────────────────────

export async function getSuggestions(locationId) {
  const { data } = await supabase
    .from('suggestions')
    .select('*')
    .eq('location_id', locationId)
    .eq('status', 'approved')
  return (data || []).map(normalise)
}

export async function getAllPendingSuggestions() {
  const { data } = await supabase
    .from('suggestions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  return (data || []).map(s => ({ ...normalise(s), displayLocation: s.location_name }))
}

export async function getSuggestionsForUser(userId) {
  // userId here is the supabase UUID stored in user.supabaseId
  const { data } = await supabase
    .from('suggestions')
    .select('*')
    .eq('author_id', userId)
    .order('created_at', { ascending: false })
  return (data || []).map(s => ({ ...normalise(s), displayLocation: s.location_name }))
}

export async function addSuggestion({ locationId, locationName, category, text, date, photo, authorId, authorUsername }) {
  let photoUrl = null
  if (photo) {
    try {
      const base64 = photo.split(',')[1]
      const blob   = await fetch(`data:image/jpeg;base64,${base64}`).then(r => r.blob())
      const fname  = `${locationId}-${Date.now()}.jpg`
      const { data: up } = await supabase.storage
        .from('suggestion-photos')
        .upload(fname, blob, { contentType: 'image/jpeg', upsert: true })
      if (up) {
        const { data: pu } = supabase.storage.from('suggestion-photos').getPublicUrl(up.path)
        photoUrl = pu?.publicUrl
      }
    } catch(e) { console.warn('Photo upload failed:', e) }
  }

  const { error } = await supabase.from('suggestions').insert({
    location_id:     locationId,
    location_name:   locationName,
    category,
    text,
    date_info:       date || null,
    photo_url:       photoUrl,
    author_id:       authorId,
    author_username: authorUsername,
    status:          'pending',
  })

  return !error
}

export async function setSuggestionStatus(id, status) {
  await supabase.from('suggestions').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
}

export async function deleteSuggestion(id) {
  await supabase.from('suggestions').delete().eq('id', id)
}

// ── Normalise Supabase row → component format ─────────────────────────────
function normalise(s) {
  return {
    id:           s.id,
    category:     s.category,
    text:         s.text,
    date:         s.date_info,
    date_info:    s.date_info,
    photo:        s.photo_url,
    photo_url:    s.photo_url,
    author:       s.author_username,
    author_id:    s.author_id,
    locationName: s.location_name,
    status:       s.status,
    createdAt:    new Date(s.created_at).getTime(),
    created_at:   s.created_at,
  }
}

// ── Image helpers ─────────────────────────────────────────────────────────
export function compressImage(file, maxW = 700) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width)
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.width  * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.78))
      }
      img.onerror = reject
      img.src = e.target.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Stub helpers (not used with Supabase) ────────────────────────────────
export function getGallery()  { return [] }
export function saveGallery() {}
export const readStore  = () => ({})
export const writeStore = () => {}
