import 'server-only'
import { admin } from './supabase'

let last = 0
let running: Promise<void> | null = null

/**
 * WordPress "future" posts/products go live when their date passes. Instead of WP-Cron we promote due rows
 * (site_dayinup.publish_due(), service role) lazily before rendering, at most once a minute per server instance.
 */
export function publishDue(): Promise<void> {
  if (Date.now() - last < 60_000) return running || Promise.resolve()
  last = Date.now()
  running = (async () => {
    try {
      await admin().rpc('publish_due')
    } catch {
      /* never block rendering */
    } finally {
      running = null
    }
  })()
  return running
}
