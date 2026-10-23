import 'server-only'
import { cache } from 'react'
import { db } from './supabase'

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>

export const PER_PAGE = 15

export const getSettings = cache(async (): Promise<Record<string, any>> => {
  const { data, error } = await db().from('settings').select('key,value')
  if (error) throw error
  const out: Record<string, any> = {}
  for (const r of data || []) out[r.key] = r.value
  return out
})

export const getMenuItems = cache(async (): Promise<Row[]> => {
  const { data, error } = await db()
    .from('menu_items')
    .select('id,menu_id,parent_id,position,label,url,object_type,object_id,target,classes,menus!inner(slug,location)')
    .order('position')
  if (error) throw error
  return data || []
})

export const getTerms = cache(async (): Promise<Row[]> => {
  const { data, error } = await db().from('terms').select('id,taxonomy,slug,name,description,parent_id,count,path,meta,seo:meta')
  if (error) throw error
  return data || []
})

export const getAuthors = cache(async (): Promise<Row[]> => {
  const { data, error } = await db().from('authors').select('*')
  if (error) throw error
  return data || []
})

export async function getMediaMap(ids: (number | null | undefined)[]): Promise<Map<number, Row>> {
  const uniq = [...new Set(ids.filter((x): x is number => typeof x === 'number'))]
  const m = new Map<number, Row>()
  if (!uniq.length) return m
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await db()
      .from('media')
      .select('id,title,alt_text,caption_html,mime_type,public_url,width,height,meta')
      .in('id', uniq.slice(i, i + 200))
    if (error) throw error
    for (const r of data || []) m.set(r.id, r)
  }
  return m
}

const POST_COLS =
  'id,post_type,slug,path,status,title,content_html,excerpt_html,author_id,featured_media_id,parent_id,menu_order,comment_status,template,date,modified,seo,meta'

export const getPostByPath = cache(async (path: string): Promise<Row | null> => {
  const { data, error } = await db()
    .from('posts')
    .select(POST_COLS)
    .eq('path', path)
    .in('post_type', ['post', 'page'])
    .eq('status', 'publish')
    .limit(1)
  if (error) throw error
  return data?.[0] || null
})

export const getPostById = cache(async (id: number): Promise<Row | null> => {
  const { data, error } = await db().from('posts').select(POST_COLS).eq('id', id).limit(1)
  if (error) throw error
  return data?.[0] || null
})

export async function getPostTerms(postIds: number[]): Promise<Map<number, Row[]>> {
  const out = new Map<number, Row[]>()
  if (!postIds.length) return out
  const terms = await getTerms()
  const byId = new Map(terms.map((t) => [t.id, t]))
  const { data, error } = await db().from('post_terms').select('post_id,term_id,term_order').in('post_id', postIds)
  if (error) throw error
  for (const r of data || []) {
    const t = byId.get(r.term_id)
    if (!t) continue
    if (!out.has(r.post_id)) out.set(r.post_id, [])
    out.get(r.post_id)!.push(t)
  }
  return out
}

/** Term + all descendant term ids (WP archives include child terms). */
export async function termWithChildren(termId: number): Promise<number[]> {
  const terms = await getTerms()
  const ids = [termId]
  for (let i = 0; i < ids.length; i++) for (const t of terms) if (t.parent_id === ids[i]) ids.push(t.id)
  return ids
}

export async function listPosts(opts: {
  termIds?: number[]
  authorId?: number
  search?: string
  page?: number
  perPage?: number
  excludeId?: number
  types?: string[]
}): Promise<{ rows: Row[]; total: number }> {
  const perPage = opts.perPage ?? PER_PAGE
  const page = Math.max(1, opts.page ?? 1)
  let ids: number[] | null = null
  if (opts.termIds) {
    const { data, error } = await db().from('post_terms').select('post_id').in('term_id', opts.termIds)
    if (error) throw error
    ids = [...new Set((data || []).map((r) => r.post_id))]
    if (!ids.length) return { rows: [], total: 0 }
  }
  let q = db()
    .from('posts')
    .select('id,post_type,slug,path,title,excerpt_html,author_id,featured_media_id,date,modified,meta', { count: 'exact' })
    .in('post_type', opts.types ?? ['post'])
    .eq('status', 'publish')
  if (ids) q = q.in('id', ids)
  if (opts.authorId) q = q.eq('author_id', opts.authorId)
  if (opts.excludeId) q = q.neq('id', opts.excludeId)
  if (opts.search) {
    const s = opts.search.replace(/[%,()]/g, ' ').trim()
    q = q.or(`title.ilike.%${s}%,content_html.ilike.%${s}%`)
  }
  q = q.order('sticky', { ascending: false }).order('date', { ascending: false }).range((page - 1) * perPage, page * perPage - 1)
  const { data, error, count } = await q
  if (error) throw error
  return { rows: data || [], total: count || 0 }
}

/* ---------------------------------------------------------------- products */
const PRODUCT_LIST_COLS =
  'id,slug,path,name,type,status,featured,regular_price,sale_price,price,price_min,price_max,on_sale,stock_status,manage_stock,stock_quantity,backorders,is_purchasable,featured_media_id,menu_order,date,meta,short_description_html'

export async function getProductTerms(productIds: number[]): Promise<Map<number, Row[]>> {
  const out = new Map<number, Row[]>()
  if (!productIds.length) return out
  const terms = await getTerms()
  const byId = new Map(terms.map((t) => [t.id, t]))
  const { data, error } = await db().from('product_terms').select('product_id,term_id').in('product_id', productIds)
  if (error) throw error
  for (const r of data || []) {
    const t = byId.get(r.term_id)
    if (!t) continue
    if (!out.has(r.product_id)) out.set(r.product_id, [])
    out.get(r.product_id)!.push(t)
  }
  for (const v of out.values()) v.sort((a, b) => a.id - b.id)
  return out
}

export type ProductOrder = 'menu_order' | 'popularity' | 'rating' | 'date' | 'price' | 'price-desc' | 'title'

export async function listProducts(opts: {
  termIds?: number[]
  page?: number
  perPage?: number
  orderby?: string
  search?: string
  ids?: number[]
  excludeId?: number
}): Promise<{ rows: Row[]; total: number }> {
  const perPage = opts.perPage ?? PER_PAGE
  const page = Math.max(1, opts.page ?? 1)
  let ids: number[] | null = opts.ids ?? null
  if (opts.termIds) {
    const { data, error } = await db().from('product_terms').select('product_id').in('term_id', opts.termIds)
    if (error) throw error
    ids = [...new Set((data || []).map((r) => r.product_id))]
    if (!ids.length) return { rows: [], total: 0 }
  }
  let q = db()
    .from('products')
    .select(PRODUCT_LIST_COLS, { count: 'exact' })
    .eq('status', 'publish')
    .in('catalog_visibility', opts.search ? ['visible', 'search'] : ['visible', 'catalog'])
  if (ids) q = q.in('id', ids)
  if (opts.excludeId) q = q.neq('id', opts.excludeId)
  if (opts.search) {
    const s = opts.search.replace(/[%,()]/g, ' ').trim()
    q = q.or(`name.ilike.%${s}%,description_html.ilike.%${s}%,short_description_html.ilike.%${s}%`)
  }
  switch (opts.orderby) {
    case 'price':
      q = q.order('price_min', { ascending: true, nullsFirst: false }).order('price', { ascending: true })
      break
    case 'price-desc':
      q = q.order('price_max', { ascending: false, nullsFirst: false }).order('price', { ascending: false })
      break
    case 'title':
      q = q.order('name', { ascending: true })
      break
    case 'date':
    case 'popularity':
    case 'rating':
      q = q.order('date', { ascending: false })
      break
    default:
      q = q.order('menu_order', { ascending: true }).order('date', { ascending: false })
  }
  q = q.order('id', { ascending: false }).range((page - 1) * perPage, page * perPage - 1)
  const { data, error, count } = await q
  if (error) throw error
  return { rows: data || [], total: count || 0 }
}

export const getProductBySlug = cache(async (slug: string): Promise<Row | null> => {
  const { data, error } = await db().from('products').select('*').eq('slug', slug).eq('status', 'publish').limit(1)
  if (error) throw error
  const p = data?.[0]
  if (!p) return null
  const [imgs, vars, attrs, rules] = await Promise.all([
    db().from('product_images').select('media_id,position').eq('product_id', p.id).order('position'),
    db().from('product_variations').select('*').eq('product_id', p.id).eq('status', 'publish').order('menu_order'),
    db().from('product_attributes').select('*').eq('product_id', p.id).order('position'),
    db().from('quantity_discount_rules').select('*').eq('product_id', p.id).eq('active', true).order('priority'),
  ])
  for (const r of [imgs, vars, attrs, rules]) if (r.error) throw r.error
  p.images = imgs.data || []
  p.variations = vars.data || []
  p.attributes = attrs.data || []
  p.discount_rules = rules.data || []
  return p
})

export async function getProductsByIds(ids: number[]): Promise<Row[]> {
  if (!ids.length) return []
  const { data, error } = await db().from('products').select(PRODUCT_LIST_COLS).in('id', ids)
  if (error) throw error
  return data || []
}
