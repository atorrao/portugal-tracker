import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

const Ctx = createContext(null)
const ADMIN_EMAIL = 'admin@poronde.app'
const ADMIN_PASS  = 'admin1234'

export function AuthProvider({ children }) {
  const [user,  setUser]  = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Check existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) loadProfile(session.user)
      else setReady(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) loadProfile(session.user)
      else { setUser(null); setReady(true) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(authUser) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (profile) {
      setUser({
        id: profile.username || authUser.email,
        supabaseId: authUser.id,
        email: authUser.email,
        ...profile,
        photo: profile.photo_url,
        isAdmin: profile.is_admin,
        visited_municipalities: profile.visited_municipalities || [],
        visited_parishes: profile.visited_parishes || [],
      })
    }
    setReady(true)
  }

  const login = useCallback(async (username, password) => {
    const key = username.trim().toLowerCase()

    // Try as email directly first (for admin and email-based users)
    let email = key.includes('@') ? key : `${key}@poronde.app`

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      // If failed with synthetic email, try as literal email
      if (!key.includes('@')) {
        const { error: e2 } = await supabase.auth.signInWithPassword({ email: key, password })
        if (e2) return { err: 'Utilizador ou palavra-passe incorretos.' }
      } else {
        return { err: 'Utilizador ou palavra-passe incorretos.' }
      }
    }

    // Check approval after login
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const { data: profile } = await supabase.from('profiles').select('approved').eq('id', session.user.id).single()
      if (profile && !profile.approved && !profile.is_admin) {
        await supabase.auth.signOut()
        return { err: 'A tua conta está a aguardar aprovação. Receberás indicação quando puder entrar.' }
      }
    }

    return { ok: true }
  }, [])

  const register = useCallback(async (username, password, photo, country) => {
    const key = username.trim().toLowerCase()
    if (key.length < 2)      return { err: 'Nome demasiado curto (mín. 2 caracteres).' }
    if (password.length < 4) return { err: 'Palavra-passe demasiado curta (mín. 4 caracteres).' }

    // Check if username already taken
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', key)
      .maybeSingle()

    if (existing) return { err: 'Este utilizador já existe.' }

    const email = `${key}@poronde.app`

    // Sign up
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username: key, country: country || 'Portugal' } }
    })

    if (error) return { err: error.message }

    // Wait a moment for trigger to create profile, then update it
    if (data.user) {
      await new Promise(r => setTimeout(r, 800))

      // Upload photo if provided
      let photoUrl = null
      if (photo) {
        try {
          const base64 = photo.split(',')[1]
          const blob   = await fetch(`data:image/jpeg;base64,${base64}`).then(r => r.blob())
          const { data: up } = await supabase.storage
            .from('profile-photos')
            .upload(`${key}-${Date.now()}.jpg`, blob, { contentType: 'image/jpeg', upsert: true })
          if (up) {
            const { data: pu } = supabase.storage.from('profile-photos').getPublicUrl(up.path)
            photoUrl = pu?.publicUrl
          }
        } catch(e) { console.warn('Photo upload failed:', e) }
      }

      await supabase.from('profiles').upsert({
        id: data.user.id,
        username: key,
        country: country || 'Portugal',
        photo_url: photoUrl,
        approved: false,
        is_admin: false,
      })
    }

    // Sign out — user must wait for admin approval
    await supabase.auth.signOut()
    return { pending: true }
  }, [])

  const logout = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
  }, [])

  const saveVisited = useCallback(async (list, level) => {
    if (!user?.supabaseId) return
    const col = level === 'parishes' ? 'visited_parishes' : 'visited_municipalities'
    await supabase.from('profiles').update({ [col]: list }).eq('id', user.supabaseId)
    setUser(prev => prev ? { ...prev, [col]: list } : prev)
  }, [user])

  const updatePhoto = useCallback(async (photoBase64) => {
    if (!user?.supabaseId) return
    try {
      const base64 = photoBase64.split(',')[1]
      const blob   = await fetch(`data:image/jpeg;base64,${base64}`).then(r => r.blob())
      const { data } = await supabase.storage
        .from('profile-photos')
        .upload(`${user.id}-${Date.now()}.jpg`, blob, { contentType: 'image/jpeg', upsert: true })
      if (data) {
        const { data: pu } = supabase.storage.from('profile-photos').getPublicUrl(data.path)
        await supabase.from('profiles').update({ photo_url: pu.publicUrl }).eq('id', user.supabaseId)
        setUser(prev => prev ? { ...prev, photo: pu.publicUrl, photo_url: pu.publicUrl } : prev)
      }
    } catch(e) { console.error('Photo update failed:', e) }
  }, [user])

  const getAllUsers = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_admin', false)
      .order('joined_at', { ascending: false })
    return (data || []).map(p => ({
      id: p.username,
      supabaseId: p.id,
      ...p,
      photo: p.photo_url,
      isAdmin: p.is_admin,
      visited_municipalities: p.visited_municipalities || [],
      visited_parishes: p.visited_parishes || [],
    }))
  }, [])

  const setUserApproved = useCallback(async (supabaseId, approved) => {
    await supabase.from('profiles').update({ approved }).eq('id', supabaseId)
  }, [])

  const deleteUser = useCallback(async (supabaseId) => {
    await supabase.from('profiles').delete().eq('id', supabaseId)
  }, [])

  const resetPassword = useCallback(async (supabaseId, newPw) => {
    // Requires service role key — not available client-side
    // Store new password hint in profile for now
    console.warn('Password reset requires Supabase dashboard or service role key')
  }, [])

  return (
    <Ctx.Provider value={{
      user, ready, login, register, logout,
      saveVisited, updatePhoto, getAllUsers, setUserApproved,
      deleteUser, resetPassword,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAuth = () => useContext(Ctx)
