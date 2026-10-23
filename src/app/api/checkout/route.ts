/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { admin } from '@/lib/supabase'
import { getCartRow, summarize } from '@/lib/cart'
import { currentUser, customerFor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const FIELD_ORDER = ['email', 'country', 'first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'phone']

/**
 * Creates a WooCommerce-equivalent order in status "pending" (待付款).
 * No payment gateway is called — the old site's NewebPay (ry_newebpay_credit) is intentionally NOT integrated.
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const db = admin()
  const cart = await getCartRow(false)
  const sum = await summarize(cart)
  if (!cart || !sum.items.length) return NextResponse.json({ ok: false, error: '您的購物車是空的。' }, { status: 400 })
  const unavailable = sum.items.filter((i) => !i.in_stock)
  if (unavailable.length) return NextResponse.json({ ok: false, error: `「${unavailable[0].name}」已售完，請從購物車移除後再結帳。` }, { status: 400 })

  const set = await db.from('settings').select('value').eq('key', 'woocommerce.checkout_fields').single()
  const fields: Record<string, any> = set.data?.value || {}
  const billing: Record<string, string> = {}
  const errors: string[] = []
  for (const k of FIELD_ORDER) {
    const f = fields[k]
    const v = String(b.billing?.[k] ?? (k === 'country' ? 'TW' : '')).trim().slice(0, 300)
    if (f && !f.hidden && f.required && !v) errors.push(`${f.label} 為必填欄位。`)
    if (v) billing[k] = v
  }
  if (billing.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing.email)) errors.push('請輸入有效的電子郵件地址。')
  if (billing.phone && !/^[0-9+\-()\s#]{6,20}$/.test(billing.phone)) errors.push('請輸入有效的電話號碼。')
  if (!billing.country) billing.country = 'TW'
  if (errors.length) return NextResponse.json({ ok: false, error: errors.join('\n'), errors }, { status: 400 })

  const user = await currentUser()
  let customerId: number | null = null
  if (user) {
    const c = await customerFor(user)
    customerId = c?.id ?? null
    if (c && b.save_address !== false) await db.from('customers').update({ billing, date_modified: new Date().toISOString() }).eq('id', c.id)
  }
  const attribution: Record<string, string> = {}
  for (const [k, v] of Object.entries(b.attribution || {})) if (typeof v === 'string' || typeof v === 'number') attribution[k] = String(v).slice(0, 500)

  const ins = await db
    .from('orders')
    .insert({
      status: 'pending',
      currency: 'TWD',
      customer_id: customerId,
      billing_email: billing.email || user?.email || null,
      billing,
      shipping: {},
      payment_method: 'pending',
      payment_method_title: '待付款（尚未串接線上金流）',
      customer_note: String(b.customer_note || '').slice(0, 2000) || null,
      subtotal: sum.subtotal,
      discount_total: sum.discount,
      total: sum.total,
      coupon_codes: sum.coupons.map((c) => c.code),
      customer_ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
      customer_user_agent: (req.headers.get('user-agent') || '').slice(0, 500),
      created_via: 'checkout',
      attribution,
      date_modified: new Date().toISOString(),
      meta: { source: 'dayinup-next', legacy_gateway: 'ry_newebpay_credit (not connected)' },
    })
    .select('id,order_key')
    .single()
  if (ins.error) return NextResponse.json({ ok: false, error: '建立訂單失敗，請稍後再試。' }, { status: 500 })
  const orderId = ins.data.id

  const lines: any[] = sum.items.map((i) => ({
    order_id: orderId,
    item_type: 'line_item',
    name: i.name + (Object.keys(i.variation).length ? ' - ' + Object.values(i.variation).join(', ') : ''),
    product_id: i.product_id,
    variation_id: i.variation_id,
    quantity: i.quantity,
    subtotal: i.line_total,
    total: i.line_total,
    variation: i.variation,
    meta: { unit_price: i.unit_price, regular_price: i.regular_price },
  }))
  for (const c of sum.coupons) lines.push({ order_id: orderId, item_type: 'coupon', name: c.code, quantity: 1, subtotal: 0, total: -c.amount, meta: { discount: c.amount } })
  const li = await db.from('order_items').insert(lines)
  if (li.error) {
    await db.from('orders').update({ status: 'failed' }).eq('id', orderId)
    return NextResponse.json({ ok: false, error: '建立訂單項目失敗，請稍後再試。' }, { status: 500 })
  }
  await db.from('order_notes').insert({ order_id: orderId, note: '訂單已建立，狀態：待付款（新站未串接金流）。', added_by: 'system' })
  for (const c of sum.coupons) {
    const cur = await db.from('coupons').select('id,usage_count,used_by').ilike('code', c.code).limit(1)
    const row = cur.data?.[0]
    if (row) await db.from('coupons').update({ usage_count: (row.usage_count || 0) + 1, used_by: [...(row.used_by || []), billing.email || ''] }).eq('id', row.id)
  }
  await db.from('cart_items').delete().eq('cart_id', cart.id)
  await db.from('carts').update({ coupon_codes: [], customer_id: customerId }).eq('id', cart.id)
  return NextResponse.json({ ok: true, order_id: orderId, order_key: ins.data.order_key, redirect: `/checkout/order-received/${orderId}/?key=${ins.data.order_key}` })
}
