/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only'
import { cookies } from 'next/headers'
import { admin } from './supabase'

export const CART_COOKIE = 'dayinup_cart'

export type CartLine = {
  key: number
  product_id: number
  variation_id: number | null
  name: string
  variation: Record<string, string>
  quantity: number
  unit_price: number
  regular_price: number
  line_total: number
  image: string | null
  path: string
  in_stock: boolean
  sold_individually: boolean
  max_qty: number | null
}

export type CartSummary = {
  id: string | null
  items: CartLine[]
  count: number
  subtotal: number
  discount: number
  total: number
  coupons: { code: string; amount: number }[]
}

async function sessionKey(create: boolean): Promise<string | null> {
  const jar = await cookies()
  let key = jar.get(CART_COOKIE)?.value || null
  if (!key && create) {
    key = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    jar.set(CART_COOKIE, key, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 })
  }
  return key
}

export async function getCartRow(create: boolean): Promise<any | null> {
  const key = await sessionKey(create)
  if (!key) return null
  const db = admin()
  const { data, error } = await db.from('carts').select('*').eq('session_key', key).limit(1)
  if (error) throw error
  if (data?.[0]) return data[0]
  if (!create) return null
  const ins = await db.from('carts').insert({ session_key: key }).select('*').single()
  if (ins.error) throw ins.error
  return ins.data
}

/** Price + availability straight from the catalog (never trust the browser). */
export async function priceFor(productId: number, variationId: number | null) {
  const db = admin()
  const { data: p, error } = await db.from('products').select('id,name,slug,path,type,status,price,regular_price,sale_price,stock_status,manage_stock,stock_quantity,backorders,is_purchasable,sold_individually,featured_media_id').eq('id', productId).single()
  if (error || !p || p.status !== 'publish') return { error: '找不到此商品。' }
  let v: any = null
  if (p.type === 'variable') {
    if (!variationId) return { error: '在加入購物車前，請先選擇商品選項。' }
    const r = await db.from('product_variations').select('*').eq('id', variationId).eq('product_id', productId).single()
    if (r.error || !r.data || r.data.status !== 'publish') return { error: '請選擇有效的商品選項。' }
    v = r.data
  }
  const src = v || p
  const stock = src.stock_status
  const inStock = stock !== 'outofstock'
  if (!inStock || p.is_purchasable === false || (v && v.is_purchasable === false)) return { error: `您無法將「${p.name}」加入購物車，因為此商品已售完。` }
  const unit = Number(src.price ?? src.regular_price ?? 0)
  // WooCommerce: a managed stock of 0 that is still in stock/on backorder means backorders are allowed → no cap
  const maxQty = src.manage_stock && src.stock_status === 'instock' && src.backorders === 'no' && Number(src.stock_quantity) > 0 ? Number(src.stock_quantity) : null
  return { product: p, variation: v, unit, regular: Number(src.regular_price ?? unit), maxQty }
}

export async function summarize(cart: any | null): Promise<CartSummary> {
  if (!cart) return { id: null, items: [], count: 0, subtotal: 0, discount: 0, total: 0, coupons: [] }
  const db = admin()
  const { data: rows, error } = await db.from('cart_items').select('*').eq('cart_id', cart.id).order('id')
  if (error) throw error
  const items: CartLine[] = []
  const pids = [...new Set((rows || []).map((r) => r.product_id))]
  const vids = [...new Set((rows || []).map((r) => r.variation_id).filter(Boolean))]
  const [prods, vars] = await Promise.all([
    pids.length ? db.from('products').select('id,name,path,type,price,regular_price,stock_status,featured_media_id,sold_individually,status').in('id', pids) : Promise.resolve({ data: [] as any[] }),
    vids.length ? db.from('product_variations').select('id,product_id,attributes,price,regular_price,stock_status,image_media_id,manage_stock,stock_quantity,backorders').in('id', vids) : Promise.resolve({ data: [] as any[] }),
  ])
  const pm = new Map((prods.data || []).map((p: any) => [p.id, p]))
  const vm = new Map((vars.data || []).map((v: any) => [v.id, v]))
  const mids = [...(prods.data || []).map((p: any) => p.featured_media_id), ...(vars.data || []).map((v: any) => v.image_media_id)].filter(Boolean)
  const media = mids.length ? await db.from('media').select('id,public_url').in('id', mids) : { data: [] as any[] }
  const mm = new Map((media.data || []).map((m: any) => [m.id, m.public_url]))
  for (const r of rows || []) {
    const p: any = pm.get(r.product_id)
    if (!p || p.status !== 'publish') continue
    const v: any = r.variation_id ? vm.get(r.variation_id) : null
    const src = v || p
    const unit = Number(src.price ?? src.regular_price ?? 0)
    items.push({
      key: r.id,
      product_id: r.product_id,
      variation_id: r.variation_id,
      name: p.name,
      variation: v?.attributes || r.variation || {},
      quantity: r.quantity,
      unit_price: unit,
      regular_price: Number(src.regular_price ?? unit),
      line_total: unit * r.quantity,
      image: mm.get((v && v.image_media_id) || p.featured_media_id) || null,
      path: p.path,
      in_stock: src.stock_status !== 'outofstock',
      sold_individually: !!p.sold_individually,
      max_qty: v && v.manage_stock && v.backorders === 'no' && v.stock_status === 'instock' && Number(v.stock_quantity) > 0 ? v.stock_quantity : null,
    })
  }
  const subtotal = items.reduce((s, i) => s + i.line_total, 0)
  // coupons
  const coupons: { code: string; amount: number }[] = []
  let discount = 0
  for (const code of cart.coupon_codes || []) {
    const c = await couponByCode(code)
    if (!c) continue
    const amt = couponDiscount(c, items, subtotal - discount)
    discount += amt
    coupons.push({ code: c.code, amount: amt })
  }
  return { id: cart.id, items, count: items.reduce((s, i) => s + i.quantity, 0), subtotal, discount, total: Math.max(0, subtotal - discount), coupons }
}

export async function couponByCode(code: string) {
  const { data } = await admin().from('coupons').select('*').ilike('code', code.trim()).neq('status', 'trash').limit(1)
  const c = data?.[0]
  if (!c || c.status !== 'publish') return null
  if (c.date_expires && new Date(c.date_expires) < new Date()) return null
  if (c.usage_limit != null && c.usage_count >= c.usage_limit) return null
  return c
}

export function couponDiscount(c: any, items: CartLine[], base: number): number {
  const eligible = items.filter((i) => (!c.product_ids?.length || c.product_ids.includes(i.product_id)) && !c.excluded_product_ids?.includes(i.product_id))
  const eligibleTotal = eligible.reduce((s, i) => s + i.line_total, 0)
  if (c.minimum_amount && base < Number(c.minimum_amount)) return 0
  let amt = 0
  if (c.discount_type === 'percent') amt = Math.round((eligibleTotal * Number(c.amount)) / 100)
  else if (c.discount_type === 'fixed_product') amt = eligible.reduce((s, i) => s + Math.min(i.line_total, Number(c.amount) * i.quantity), 0)
  else amt = Math.min(Number(c.amount), base)
  return Math.min(amt, base)
}
