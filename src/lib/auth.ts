/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { admin } from './supabase'

/** Supabase Auth client bound to request cookies (session lives in httpOnly cookies). */
export async function authClient() {
  const jar = await cookies()
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const c of list) jar.set(c.name, c.value, c.options)
        } catch {
          /* called from a server component — ignore */
        }
      },
    },
  })
}

export async function currentUser() {
  try {
    const sb = await authClient()
    const { data } = await sb.auth.getUser()
    return data.user || null
  } catch {
    return null
  }
}

/** Find (or create) the site_dayinup.customers row for a Supabase user; links legacy WP customers by email. */
export async function customerFor(user: { id: string; email?: string | null; user_metadata?: any }) {
  const db = admin()
  const byAuth = await db.from('customers').select('*').eq('auth_user_id', user.id).limit(1)
  if (byAuth.data?.[0]) return byAuth.data[0]
  if (user.email) {
    const byEmail = await db.from('customers').select('*').ilike('email', user.email).is('auth_user_id', null).limit(1)
    if (byEmail.data?.[0]) {
      const up = await db.from('customers').update({ auth_user_id: user.id, date_modified: new Date().toISOString() }).eq('id', byEmail.data[0].id).select('*').single()
      return up.data
    }
  }
  const ins = await db
    .from('customers')
    .insert({ auth_user_id: user.id, email: user.email, username: user.user_metadata?.username || user.email?.split('@')[0], display_name: user.user_metadata?.username || user.email?.split('@')[0], meta: { source: 'dayinup-next' } })
    .select('*')
    .single()
  if (ins.error) throw ins.error
  return ins.data
}
