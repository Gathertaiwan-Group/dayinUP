import { NextResponse } from 'next/server'
import { admin } from '@/lib/supabase'
import { currentUser, customerFor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** Order details for the thank-you page (needs ?key=) or for the logged-in owner. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const key = new URL(req.url).searchParams.get('key') || ''
  const db = admin()
  const { data: o } = await db
    .from('orders')
    .select('id,order_key,status,currency,billing,payment_method_title,customer_note,subtotal,discount_total,total,date_created,customer_id')
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
  const { order_key: _k, customer_id: _c, ...pub } = o
  void _k
  void _c
  return NextResponse.json({ ok: true, order: { ...pub, items: items.data || [] } })
}
