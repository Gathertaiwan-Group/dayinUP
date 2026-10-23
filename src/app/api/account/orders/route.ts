import { NextResponse } from 'next/server'
import { currentUser, customerFor } from '@/lib/auth'
import { admin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ ok: false, error: '請先登入。' }, { status: 401 })
  const c = await customerFor(user)
  const { data } = await admin()
    .from('orders')
    .select('id,status,total,currency,date_created,order_items(quantity,item_type)')
    .eq('customer_id', c.id)
    .eq('type', 'shop_order')
    .neq('status', 'trash')
    .order('date_created', { ascending: false })
    .limit(100)
  return NextResponse.json({ ok: true, orders: data || [] })
}
