import { NextResponse } from 'next/server'
import { orderIdFromMerchantOrderNo, verifyInbound } from '@/lib/newebpay/core'
import { newebpayConfig } from '@/lib/newebpay/service'
import { readInbound } from '@/lib/newebpay/http'
import { admin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * ReturnURL: the customer's browser comes back here after paying. DISPLAY ONLY — never changes the order
 * (NotifyURL does). Verifies the payload just to find the order, then 303s to the thank-you page.
 */
export async function POST(req: Request) {
  const cfg = newebpayConfig()
  const home = NextResponse.redirect(new URL('/my-account/orders/', req.url), 303)
  if (!cfg) return home
  const v = verifyInbound(cfg, await readInbound(req))
  if (!v.ok) return home
  const id = orderIdFromMerchantOrderNo(String(v.data.Result.MerchantOrderNo || ''))
  if (!id) return home
  const { data } = await admin().from('orders').select('order_key').eq('id', id).maybeSingle()
  if (!data) return home
  const q = new URLSearchParams({ key: data.order_key })
  if (v.data.Status !== 'SUCCESS') q.set('nwp', 'fail')
  return NextResponse.redirect(new URL(`/checkout/order-received/${id}/?${q}`, req.url), 303)
}

export async function GET(req: Request) {
  return NextResponse.redirect(new URL('/my-account/orders/', req.url), 303)
}
