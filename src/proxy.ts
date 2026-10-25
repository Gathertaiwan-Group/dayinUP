import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Legacy WordPress URL handling (301):
 *  - attachment pages (/<attachment-slug>/, /?attachment_id=N) → media file
 *  - /?p=N, /?page_id=N, /?product=… → canonical permalink   (site_dayinup.redirects)
 *  - /wp-content/uploads/YYYY/MM/<file>[-WxH|-scaled].<ext> → new Supabase Storage URL (site_dayinup.media_url_map)
 */
type Maps = { redirects: Map<string, { target: string; code: number }>; media: Map<string, string>; at: number }
let cache: Maps | null = null
let loading: Promise<Maps> | null = null
const TTL = 10 * 60 * 1000

async function fetchAll(table: string, select: string): Promise<Record<string, string | number>[]> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) return []
  const out: Record<string, string | number>[] = []
  for (let from = 0; from < 20000; from += 1000) {
    const r = await fetch(`${url}/rest/v1/${table}?select=${select}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'site_dayinup', Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
      cache: 'no-store',
    })
    if (!r.ok) break
    const rows = (await r.json()) as Record<string, string | number>[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

async function maps(): Promise<Maps> {
  if (cache && Date.now() - cache.at < TTL) return cache
  if (!loading) {
    loading = (async () => {
      const [r, m] = await Promise.all([fetchAll('redirects', 'source_path,target,status_code'), fetchAll('media_url_map', 'old_path,new_url')])
      const redirects = new Map<string, { target: string; code: number }>()
      for (const x of r) redirects.set(norm(String(x.source_path)), { target: String(x.target), code: Number(x.status_code) || 301 })
      const media = new Map<string, string>()
      for (const x of m) media.set(norm(String(x.old_path)), String(x.new_url))
      cache = { redirects, media, at: Date.now() }
      loading = null
      return cache
    })().catch((e) => {
      loading = null
      throw e
    })
  }
  return loading
}

function norm(p: string): string {
  let s = p
  try {
    s = decodeURIComponent(p)
  } catch {
    /* keep raw */
  }
  return s.normalize('NFC').toLowerCase()
}

const QUERY_KEYS = ['p', 'page_id', 'attachment_id', 'product', 'post_type']

/** query parameters that never change the rendered page (tracking): such URLs are still served from the ISR cache */
const IGNORED_QUERY = /^(utm_\w+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|yclid|_gl|_ga|mc_cid|mc_eid|srsltid|igshid|ref)$/i

/**
 * Public pages: without a meaningful query string they are served by the ISR route (src/app/(site)/[[...slug]]);
 * ?s= / ?orderby= / ?add-to-cart= … are rewritten to the dynamic twin under /dyn/ (never linked or reachable directly).
 */
function publicPage(req: NextRequest) {
  const keys = [...req.nextUrl.searchParams.keys()].filter((k) => !IGNORED_QUERY.test(k))
  if (!keys.length) return NextResponse.next()
  const to = req.nextUrl.clone()
  to.pathname = '/dyn' + req.nextUrl.pathname
  return NextResponse.rewrite(to)
}

/** scheduled posts/products: ping /api/publish-due at most once a minute per instance (pages are static now) */
let lastDuePing = 0
function pingPublishDue(req: NextRequest, event: NextFetchEvent) {
  if (Date.now() - lastDuePing < 60_000) return
  lastDuePing = Date.now()
  const url = new URL('/api/publish-due/', req.url)
  event.waitUntil(fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'dayinup-proxy' } }).then(() => undefined, () => undefined))
}

/** /admin: own root layout (src/app/admin/layout.tsx) + keep the Supabase Auth session cookie fresh. */
async function adminRequest(req: NextRequest) {
  const headers = new Headers(req.headers)
  headers.set('x-dayinup-admin', '1')
  let res = NextResponse.next({ request: { headers } })
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (url && key) {
    const sb = createServerClient(url, key, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) req.cookies.set(name, value)
          res = NextResponse.next({ request: { headers } })
          for (const { name, value, options } of list) res.cookies.set(name, value, options)
        },
      },
    })
    try {
      await sb.auth.getUser()
    } catch {
      /* login page still renders */
    }
  }
  res.headers.set('Cache-Control', 'private, no-store')
  res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return res
}

export async function proxy(req: NextRequest, event: NextFetchEvent) {
  const { pathname, searchParams } = req.nextUrl
  // trailingSlash redirect lives here (next.config skipTrailingSlashRedirect) so /api/* — outside the matcher —
  // answers on both /api/mcp and /api/mcp/ (MCP clients POST without following a 308).
  const last = pathname.slice(pathname.lastIndexOf('/') + 1)
  if (!pathname.endsWith('/') && !last.includes('.')) {
    const to = new URL(req.url)
    to.pathname = pathname + '/'
    return NextResponse.redirect(to.toString(), 308)
  }
  if (pathname === '/admin/' || pathname.startsWith('/admin/')) return adminRequest(req)
  // the dynamic twin of the public route is internal (only reached through publicPage's rewrite)
  if (pathname === '/dyn/' || pathname.startsWith('/dyn/')) return NextResponse.rewrite(new URL('/__not-found__/', req.url), { status: 404 })
  if (pathname.startsWith('/admin-preview/')) {
    const res = NextResponse.next()
    res.headers.set('Cache-Control', 'private, no-store')
    res.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return res
  }
  try {
    if (pathname.startsWith('/wp-content/uploads/')) {
      const m = await maps()
      const hit = m.media.get(norm(pathname)) || m.media.get(norm(pathname.replace(/-\d+x\d+(?=\.\w+$)/, ''))) || m.media.get(norm(pathname.replace(/-\d+x\d+(?=\.\w+$)/, '-scaled')))
      if (hit) return NextResponse.redirect(hit, 301)
      return NextResponse.next()
    }
    if (pathname === '/' && QUERY_KEYS.some((k) => searchParams.has(k))) {
      const m = await maps()
      for (const k of QUERY_KEYS) {
        const v = searchParams.get(k)
        if (v === null) continue
        const hit = m.redirects.get(norm(`/?${k}=${v}`))
        if (hit) return NextResponse.redirect(new URL(hit.target, req.url), hit.code as 301)
      }
      pingPublishDue(req, event)
      return publicPage(req)
    }
    // attachment pages and other legacy single-segment paths
    const m = await maps()
    const key = norm(pathname.endsWith('/') ? pathname : pathname + '/')
    const hit = m.redirects.get(key)
    if (hit && key !== '/') return NextResponse.redirect(new URL(hit.target, req.url), hit.code as 301)
  } catch {
    /* never block a page because the redirect table is unreachable */
  }
  pingPublishDue(req, event)
  return publicPage(req)
}

export const config = {
  matcher: [
    '/((?!_next/|api/|wp-css/|wp-content/themes/|wp-content/plugins/|wp-content/uploads/elementor/|wp-content/uploads/blocksy/|favicon.ico|robots.txt|sitemap).*)',
  ],
}
