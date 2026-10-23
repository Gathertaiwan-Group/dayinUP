import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SCHEMA = 'site_dayinup'

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

let anon: SupabaseClient<any, any, any> | null = null
let service: SupabaseClient<any, any, any> | null = null

/** Read-only client (anon key, RLS: published content only). */
export function db() {
  if (!anon) {
    anon = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      db: { schema: SCHEMA },
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    })
  }
  return anon
}

/** Server-only privileged client for writes (orders, carts, submissions). Never expose to the browser. */
export function admin() {
  if (!service) {
    service = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      db: { schema: SCHEMA },
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    })
  }
  return service
}

export const SITE_URL = (process.env.SITE_URL || 'https://dayinup.com').replace(/\/$/, '')

/** Alias used by the admin / MCP layer. */
export const serviceDb = admin
