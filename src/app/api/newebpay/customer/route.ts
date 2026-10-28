import { NextResponse } from 'next/server'
import { orderIdFromMerchantOrderNo, processInbound, verifyInbound } from '@/lib/newebpay/core'
import { newebpayConfig, supabaseStore } from '@/lib/newebpay/service'
import { readInbound } from '@/lib/newebpay/http'
import { admin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/** CustomerURL (ATM / 超商代碼 取號完成; unused while only 信用卡 is enabled): store the payment instructions, then show the order. */
export async function POST(req: Request) {
  const cfg = newebpayConfig()
  if (!cfg) return NextResponse.redirect(new URL('/cart/', req.url), 303)
  const body = await readInbound(req)
  await processInbound(supabaseStore, cfg, body, 'customer').catch((e) => console.error('newebpay customer failed:', (e as Error).message))
  const v = verifyInbound(cfg, body)
  const id = v.ok ? orderIdFromMerchantOrderNo(String(v.data.Result.MerchantOrderNo || '')) : null
  if (!id) return NextResponse.redirect(new URL('/cart/', req.url), 303)
  const { data } = await admin().from('orders').select('order_key').eq('id', id).maybeSingle()
  if (!data) return NextResponse.redirect(new URL('/cart/', req.url), 303)
  return NextResponse.redirect(new URL(`/checkout/order-received/${id}/?key=${encodeURIComponent(data.order_key)}`, req.url), 303)
}
