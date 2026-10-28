/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { admin } from '@/lib/supabase'
import { getCartRow, summarize } from '@/lib/cart'
import { currentUser, customerFor } from '@/lib/auth'
import { cancelUnpaidOrders, checkoutGuard, publicGateways, reservedStockError } from '@/lib/newebpay/service'
import { clientIp } from '@/lib/newebpay/core'

export const dynamic = 'force-dynamic'

const FIELD_ORDER = ['email', 'country', 'first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'phone']

/**
 * Creates a WooCommerce-equivalent order in status "pending" (待付款).
 * When NEWEBPAY_* is configured the customer picks a NewebPay method (old site: 藍新信用卡) and is sent to
 * /api/newebpay/pay/<id> (signed MPG form built from the stored order total); otherwise the order simply stays 待付款.
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const db = admin()
  await cancelUnpaidOrders() // release stock held by expired unpaid orders before any stock check (never throws)
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

  const gateways = publicGateways()
  let gateway: (typeof gateways)[number] | null = null
  if (gateways.length && sum.total > 0) {
    gateway = gateways.find((g) => g.id === b.payment_method) || null
    if (!gateway) return NextResponse.json({ ok: false, error: '請選擇付款方式。' }, { status: 400 })
    // anti-hoarding: unpaid NewebPay orders hold stock, so cap them per IP / e-mail and rate-limit checkout (DB-counted)
    const blocked = await checkoutGuard(clientIp(req.headers), billing.email || null)
    if (blocked) return NextResponse.json({ ok: false, error: blocked }, { status: 429 })
    const held = await reservedStockError(sum.items).catch(() => null)
    if (held) return NextResponse.json({ ok: false, error: held }, { status: 400 })
  }

  const user = await currentUser()
  let customerId: number | null = null
  if (user) {
    const c = await customerFor(user)
    customerId = c?.id ?? null
    if (c && b.save_address !== false) await db.from('customers').update({ billing, date_modified: new Date().toISOString() }).eq('id', c.id)
  }
  // Guest checkout: WooCommerce records guests in wc_customer_lookup → find (by billing e-mail) or create a
  // site_dayinup.customers row. No auth.users account is created; it is linked later after e-mail verification.
  if (!customerId && billing.email) customerId = await guestCustomer(db, billing).catch(() => null)
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
      payment_method: gateway ? gateway.id : 'pending',
      payment_method_title: gateway ? gateway.title : '待付款（尚未串接線上金流）',
      customer_note: String(b.customer_note || '').slice(0, 2000) || null,
      subtotal: sum.subtotal,
      discount_total: sum.discount,
      total: sum.total,
      coupon_codes: sum.coupons.map((c) => c.code),
      customer_ip: clientIp(req.headers),
      customer_user_agent: (req.headers.get('user-agent') || '').slice(0, 500),
      created_via: 'checkout',
      attribution,
      date_modified: new Date().toISOString(),
      meta: gateway ? { source: 'dayinup-next', gateway: 'newebpay' } : { source: 'dayinup-next', legacy_gateway: 'ry_newebpay_credit (not connected)' },
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
  await db.from('order_notes').insert({ order_id: orderId, note: gateway ? `訂單已建立，狀態：等待付款中（${gateway.title}）。` : '訂單已建立，狀態：待付款（新站未串接金流）。', added_by: 'system' })
  for (const c of sum.coupons) {
    const cur = await db.from('coupons').select('id,usage_count,used_by').ilike('code', c.code).limit(1)
    const row = cur.data?.[0]
    if (row) await db.from('coupons').update({ usage_count: (row.usage_count || 0) + 1, used_by: [...(row.used_by || []), billing.email || ''] }).eq('id', row.id)
  }
  if (customerId) await refreshCustomerTotals(db, customerId).catch(() => null)
  await db.from('cart_items').delete().eq('cart_id', cart.id)
  await db.from('carts').update({ coupon_codes: [], customer_id: customerId }).eq('id', cart.id)
  const redirect = gateway ? `/api/newebpay/pay/${orderId}?key=${ins.data.order_key}` : `/checkout/order-received/${orderId}/?key=${ins.data.order_key}`
  return NextResponse.json({ ok: true, order_id: orderId, order_key: ins.data.order_key, redirect })
}

async function guestCustomer(db: ReturnType<typeof admin>, billing: Record<string, string>): Promise<number | null> {
  const email = billing.email.trim().toLowerCase()
  const found = await db.from('customers').select('id').eq('email', email).order('id').limit(1)
  if (found.data?.[0]) return found.data[0].id
  const now = new Date().toISOString()
  const ins = await db
    .from('customers')
    .insert({
      email,
      first_name: billing.first_name || null,
      last_name: billing.last_name || null,
      display_name: [billing.last_name, billing.first_name].filter(Boolean).join(' ') || null,
      role: 'guest',
      billing,
      shipping: {},
      is_paying_customer: false,
      orders_count: 0,
      total_spent: 0,
      date_created: now,
      date_modified: now,
      meta: { source: 'dayinup-next', guest_checkout: true },
    })
    .select('id')
    .single()
  return ins.data?.id ?? null
}

/** Same rule as the WP import: orders_count = non-trash shop orders; total_spent = paid (processing/completed/refunded) minus refunds. */
async function refreshCustomerTotals(db: ReturnType<typeof admin>, customerId: number) {
  const { data: rows } = await db.from('orders').select('id,status,type,total').eq('customer_id', customerId).neq('status', 'trash')
  const own = (rows || []).filter((o: any) => (o.type || 'shop_order') === 'shop_order')
  const paid = own.filter((o: any) => ['processing', 'completed', 'refunded'].includes(o.status))
  let spent = paid.reduce((s: number, o: any) => s + Number(o.total || 0), 0)
  if (paid.length) {
    const { data: refunds } = await db.from('orders').select('total,status').eq('type', 'shop_order_refund').in('parent_id', paid.map((o: any) => o.id))
    spent += (refunds || []).filter((r: any) => r.status !== 'trash').reduce((s: number, r: any) => s + Number(r.total || 0), 0)
  }
  await db.from('customers').update({ orders_count: own.length, total_spent: Math.round(spent * 100) / 100, date_modified: new Date().toISOString() }).eq('id', customerId)
}
