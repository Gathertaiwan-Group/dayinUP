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

/** Tag on every cached public read; refreshSite() (admin / MCP writes) expires it together with the ISR pages. */
export const CACHE_TAG = 'site'
export const REVALIDATE_SECONDS = 300

/**
 * Read-only client (anon key, RLS: published content only) for rendering public pages.
 * Reads go through the Next data cache (5 min, tag 'site') so page renders do not hit Supabase on every request.
 */
export function db() {
  if (!anon) {
    anon = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      db: { schema: SCHEMA },
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const method = (init?.method || 'GET').toUpperCase()
          if (method !== 'GET' && method !== 'HEAD') return fetch(input, { ...init, cache: 'no-store' })
          return fetch(input, { ...init, next: { revalidate: REVALIDATE_SECONDS, tags: [CACHE_TAG] } })
        },
      },
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
