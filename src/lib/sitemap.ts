import 'server-only'
import { db, SITE_URL } from './supabase'

function enc(p: string) {
  return p.split('/').map((s) => (/[^\x20-\x7e]/.test(s) ? encodeURIComponent(s).toLowerCase() : s)).join('/')
}
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type Entry = { loc: string; lastmod?: string | null; images?: string[] }

export function urlset(entries: Entry[]): string {
  const body = entries
    .map((e) => `\t<url>\n\t\t<loc>${xmlEsc(SITE_URL + enc(e.loc))}</loc>\n${e.lastmod ? `\t\t<lastmod>${new Date(e.lastmod).toISOString().replace('.000Z', '+00:00')}</lastmod>\n` : ''}${(e.images || []).map((i) => `\t\t<image:image>\n\t\t\t<image:loc>${xmlEsc(i)}</image:loc>\n\t\t</image:image>\n`).join('')}\t</url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd http://www.google.com/schemas/sitemap-image/1.1 http://www.google.com/schemas/sitemap-image/1.1/sitemap-image.xsd" xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`
}

async function media(ids: number[]) {
  const m = new Map<number, string>()
  const u = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < u.length; i += 200) {
    const { data } = await db().from('media').select('id,public_url').in('id', u.slice(i, i + 200))
    for (const r of data || []) m.set(r.id, r.public_url)
  }
  return m
}

const indexable = (seo: { robots?: string } | null) => !/noindex/.test(seo?.robots || '')

export async function postEntries(type: 'post' | 'page'): Promise<Entry[]> {
  const { data } = await db().from('posts').select('id,path,modified,featured_media_id,seo').eq('post_type', type).eq('status', 'publish').order('modified', { ascending: false })
  const rows = (data || []).filter((r) => r.path && indexable(r.seo))
  const m = await media(rows.map((r) => r.featured_media_id))
  return rows.map((r) => ({ loc: r.path, lastmod: r.modified, images: m.get(r.featured_media_id) ? [m.get(r.featured_media_id)!] : [] }))
}

export async function productEntries(): Promise<Entry[]> {
  const { data } = await db().from('products').select('id,path,modified,featured_media_id,seo').eq('status', 'publish').order('modified', { ascending: false })
  const rows = (data || []).filter((r) => r.path && indexable(r.seo))
  const m = await media(rows.map((r) => r.featured_media_id))
  return [{ loc: '/shop/', lastmod: rows[0]?.modified }, ...rows.map((r) => ({ loc: r.path, lastmod: r.modified, images: m.get(r.featured_media_id) ? [m.get(r.featured_media_id)!] : [] }))]
}

export async function categoryEntries(): Promise<Entry[]> {
  const { data } = await db().from('terms').select('path,count,meta,taxonomy').eq('taxonomy', 'category')
  return (data || []).filter((t) => t.count > 0 && indexable(t.meta?.seo)).map((t) => ({ loc: t.path }))
}

export function xml(body: string) {
  return new Response(body, { headers: { 'Content-Type': 'text/xml; charset=UTF-8', 'X-Robots-Tag': 'noindex, follow', 'Cache-Control': 'public, s-maxage=3600' } })
}
