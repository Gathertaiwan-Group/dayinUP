import { NextResponse } from 'next/server'
import { admin } from '@/lib/supabase'
import { currentUser, customerFor } from '@/lib/auth'
import { gatewayById, NEEDS_PAYMENT } from '@/lib/newebpay/core'
import { newebpayConfig } from '@/lib/newebpay/service'

export const dynamic = 'force-dynamic'

/** Order details for the thank-you page (needs ?key=) or for the logged-in owner. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const key = new URL(req.url).searchParams.get('key') || ''
  const db = admin()
  const { data: o } = await db
    .from('orders')
    .select('id,order_key,status,currency,billing,payment_method,payment_method_title,customer_note,subtotal,discount_total,total,date_created,customer_id,meta')
    .eq('id', Number(id))
    .single()
  if (!o) return NextResponse.json({ ok: false, error: '找不到訂單。' }, { status: 404 })
  let allowed = !!key && key === o.order_key
  if (!allowed) {
    const user = await currentUser()
    if (user) {
      const c = await customerFor(user)
      allowed = !!c && c.id === o.customer_id
    }
  }
  if (!allowed) return NextResponse.json({ ok: false, error: '無權檢視此訂單。' }, { status: 403 })
  const items = await db.from('order_items').select('item_type,name,quantity,total,variation,product_id').eq('order_id', o.id).order('id')
  const { order_key: _k, customer_id: _c, meta, ...pub } = o
  void _k
  void _c
  // NewebPay: ATM / 超商代碼 instructions and a 重新付款 link for unpaid orders (WooCommerce order-pay)
  const n = (meta as Record<string, any>)?.newebpay || {}
  const payment = { account: n.account, bank_code: n.bank_code, code_no: n.code_no, expire_date: n.expire_date, expire_time: n.expire_time, message: o.status === 'failed' ? n.message : undefined }
  const gw = gatewayById(o.payment_method)
  const pay_url = gw?.enabled && newebpayConfig() && NEEDS_PAYMENT.includes(o.status) ? `/api/newebpay/pay/${o.id}?key=${encodeURIComponent(o.order_key)}` : null
  return NextResponse.json({ ok: true, order: { ...pub, payment, pay_url, items: items.data || [] } })
}
