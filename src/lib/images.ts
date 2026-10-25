/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only'
import { cache } from 'react'
import { db } from './supabase'

/**
 * Responsive images: every <img> pointing at an original in bucket site-dayinup is rewritten (one pass over the
 * final page HTML, so theme chrome, generated cards and post/product content HTML are all covered) to carry a
 * srcset of the WebP variants in site-dayinup/v/<w>/… (480/960/1440w, see scripts/data/make-variants.mjs),
 * sizes, width/height, decoding="async" and loading="lazy" (except the logo and the first image of the main content).
 */

export type Variant = { w: number; h: number; path: string }
export type MediaInfo = { w: number | null; h: number | null; variants: Variant[] }

const PUBLIC_PREFIX = '/storage/v1/object/public/site-dayinup/'

function publicBase(): string {
  return (process.env.SUPABASE_URL || 'https://ozwftlkgqmewtadypsfi.supabase.co').replace(/\/$/, '') + PUBLIC_PREFIX
}

/** storage_path -> size + variants, for every image in the media library (≈400 small rows, cached with the page data). */
export const getMediaIndex = cache(async (): Promise<Map<string, MediaInfo>> => {
  const out = new Map<string, MediaInfo>()
  try {
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await db()
        .from('media')
        .select('storage_path,width,height,variants')
        .like('mime_type', 'image/%')
        .order('id')
        .range(from, from + 999)
      if (error) throw error
      for (const r of data || []) out.set(r.storage_path, { w: r.width, h: r.height, variants: Array.isArray(r.variants) ? r.variants : [] })
      if (!data || data.length < 1000) break
    }
  } catch {
    /* no index -> images keep their original src (page still renders) */
  }
  return out
})

/** srcset for a media row / index entry; '' when there are no smaller variants. */
export function srcsetOf(publicUrl: string, info: MediaInfo | null | undefined): string {
  if (!info || !info.variants?.length) return ''
  const base = publicBase()
  const parts = info.variants.filter((v) => !info.w || v.w < info.w).map((v) => `${base}${v.path} ${v.w}w`)
  if (!parts.length) return ''
  if (info.w) parts.push(`${publicUrl} ${info.w}w`)
  return parts.join(', ')
}

/** smallest variant at least `minW` wide (for fixed-size thumbnails such as cart rows). */
export function variantUrl(publicUrl: string, info: MediaInfo | null | undefined, minW: number): string {
  const v = info?.variants?.find((x) => x.w >= minW)
  return v ? publicBase() + v.path : publicUrl
}

const LOGO = /\b(?:default-logo|sticky-logo|custom-logo|mobile-logo)\b/
const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  return m ? (m[2] ?? m[3] ?? '') : null
}
const drop = (tag: string, name: string) => tag.replace(new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*')`, 'gi'), '')
const add = (tag: string, s: string) => tag.replace(/\s*\/?>$/, (end) => ` ${s}${end.includes('/') ? ' />' : '>'}`)

/**
 * Rewrite <img> tags in `html`.
 * @param priorityFirst the first bucket image gets eager loading + fetchpriority=high (above-the-fold hero / gallery)
 */
export function responsiveHtml(html: string, index: Map<string, MediaInfo>, opts: { priorityFirst?: boolean } = {}): string {
  if (!html || !html.includes('<img')) return html
  const base = publicBase()
  let first = !!opts.priorityFirst
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = attr(tag, 'src')
    if (!src || !src.startsWith(base)) return tag
    let path = src.slice(base.length).split(/[?#]/)[0]
    try {
      path = decodeURIComponent(path)
    } catch {
      /* keep raw */
    }
    if (path.startsWith('v/')) return tag
    const info = index.get(path)
    let t = tag
    const set = srcsetOf(src, info)
    const isLogo = LOGO.test(attr(t, 'class') || '')
    const eager = isLogo || /\sfetchpriority\s*=\s*["']high/i.test(t) || first
    if (first && !isLogo) {
      first = false
      t = drop(t, 'loading')
      if (!/\sfetchpriority=/i.test(t)) t = add(t, 'fetchpriority="high"')
    }
    if (set) {
      t = drop(drop(t, 'srcset'), 'sizes')
      const w = info?.w || 1440
      const fallback = isLogo ? '(max-width: 999px) 200px, 300px' : `(max-width: ${Math.min(w, 1440)}px) 100vw, ${Math.min(w, 1440)}px`
      t = add(t, `srcset="${set}" sizes="${eager ? fallback : `auto, ${fallback}`}"`)
    } else if (info) {
      // WP srcset entries all collapsed to the same original URL during migration: they only add noise
      t = drop(drop(t, 'srcset'), 'sizes')
    }
    if (info?.w && info?.h && attr(t, 'width') === null && attr(t, 'height') === null) t = add(t, `width="${info.w}" height="${info.h}"`)
    if (!eager && attr(t, 'loading') === null) t = add(t, 'loading="lazy"')
    if (attr(t, 'decoding') === null) t = add(t, 'decoding="async"')
    return t
  })
}
