import 'server-only'
import { admin } from './supabase'
import { refreshSite } from './admin/service'

let last = 0
let running: Promise<number> | null = null

/**
 * WordPress "future" posts/products go live when their date passes. Instead of WP-Cron we promote due rows
 * (site_dayinup.publish_due(), service role) lazily before rendering, at most once a minute per server instance.
 */
export function publishDue(): Promise<number> {
  if (Date.now() - last < 60_000) return running || Promise.resolve(0)
  last = Date.now()
  running = (async () => {
    try {
      const { data } = await admin().rpc('publish_due')
      const n = Number(data) || 0
      if (n > 0) refreshSite() // public pages are ISR-cached: show the newly published rows (no-op during a render)
      return n
    } catch {
      return 0 /* never block rendering */
    } finally {
      running = null
    }
  })()
  return running
}
