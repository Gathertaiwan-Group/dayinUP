import { NextResponse } from 'next/server'
import { admin } from '@/lib/supabase'
import { getCartRow, priceFor, summarize, couponByCode } from '@/lib/cart'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ok: true, cart: await summarize(await getCartRow(false)) })
}

/** add item: {product_id, variation_id?, quantity, variation?} */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const pid = Number(b.product_id)
  const vid = b.variation_id ? Number(b.variation_id) : null
  const qty = Math.max(1, Math.min(9999, parseInt(b.quantity, 10) || 1))
  if (!pid) return NextResponse.json({ ok: false, error: '缺少商品。' }, { status: 400 })
  const pr = await priceFor(pid, vid)
  if ('error' in pr) return NextResponse.json({ ok: false, error: pr.error }, { status: 400 })
  const cart = await getCartRow(true)
  const db = admin()
  const existing = await db.from('cart_items').select('*').eq('cart_id', cart.id).eq('product_id', pid).limit(50)
  const same = (existing.data || []).find((r) => (r.variation_id ?? null) === vid)
  let newQty = (same?.quantity || 0) + qty
  if (pr.product.sold_individually) newQty = 1
  if (pr.maxQty != null && newQty > pr.maxQty) return NextResponse.json({ ok: false, error: `庫存不足，最多可購買 ${pr.maxQty} 件。` }, { status: 400 })
  if (same) await db.from('cart_items').update({ quantity: newQty, unit_price: pr.unit }).eq('id', same.id)
  else await db.from('cart_items').insert({ cart_id: cart.id, product_id: pid, variation_id: vid, quantity: newQty, unit_price: pr.unit, variation: pr.variation?.attributes || {} })
  await db.from('carts').update({ expires_at: new Date(Date.now() + 30 * 864e5).toISOString() }).eq('id', cart.id)
  return NextResponse.json({ ok: true, cart: await summarize(cart) })
}

/** update qty {key, quantity} | apply coupon {coupon} | remove coupon {remove_coupon} */
export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  const cart = await getCartRow(false)
  if (!cart) return NextResponse.json({ ok: false, error: '購物車是空的。' }, { status: 400 })
  const db = admin()
  if (b.coupon !== undefined) {
    const c = await couponByCode(String(b.coupon || ''))
    if (!c) return NextResponse.json({ ok: false, error: `優惠券「${String(b.coupon).slice(0, 40)}」不存在或已失效！`, cart: await summarize(cart) }, { status: 400 })
    const codes = [...new Set([...(cart.coupon_codes || []), c.code])]
    await db.from('carts').update({ coupon_codes: c.individual_use ? [c.code] : codes }).eq('id', cart.id)
    cart.coupon_codes = c.individual_use ? [c.code] : codes
    return NextResponse.json({ ok: true, cart: await summarize(cart) })
  }
  if (b.remove_coupon !== undefined) {
    cart.coupon_codes = (cart.coupon_codes || []).filter((x: string) => x.toLowerCase() !== String(b.remove_coupon).toLowerCase())
    await db.from('carts').update({ coupon_codes: cart.coupon_codes }).eq('id', cart.id)
    return NextResponse.json({ ok: true, cart: await summarize(cart) })
  }
  const key = Number(b.key)
  const qty = parseInt(b.quantity, 10)
  const row = await db.from('cart_items').select('*').eq('id', key).eq('cart_id', cart.id).single()
  if (row.error || !row.data) return NextResponse.json({ ok: false, error: '找不到購物車項目。' }, { status: 404 })
  if (!qty || qty < 1) await db.from('cart_items').delete().eq('id', key)
  else {
    const pr = await priceFor(row.data.product_id, row.data.variation_id)
    if ('error' in pr) return NextResponse.json({ ok: false, error: pr.error, cart: await summarize(cart) }, { status: 400 })
    if (pr.maxQty != null && qty > pr.maxQty) return NextResponse.json({ ok: false, error: `庫存不足，最多可購買 ${pr.maxQty} 件。`, cart: await summarize(cart) }, { status: 400 })
    await db.from('cart_items').update({ quantity: pr.product.sold_individually ? 1 : Math.min(qty, 9999) }).eq('id', key)
  }
  return NextResponse.json({ ok: true, cart: await summarize(cart) })
}

/** remove item {key} */
export async function DELETE(req: Request) {
  const b = await req.json().catch(() => ({}))
  const cart = await getCartRow(false)
  if (cart) await admin().from('cart_items').delete().eq('id', Number(b.key)).eq('cart_id', cart.id)
  return NextResponse.json({ ok: true, cart: await summarize(cart) })
}
