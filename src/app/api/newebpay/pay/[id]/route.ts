import { NextResponse } from 'next/server'
import { buildMpgForm, gatewayById, generateMerchantOrderNo, NEEDS_PAYMENT, orderAmount } from '@/lib/newebpay/core'
import { baseUrl, issueMerchantOrderNo, newebpayConfig } from '@/lib/newebpay/service'
import { esc } from '@/lib/newebpay/http'
import { admin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * WooCommerce order-pay step: builds the signed MPG form from the ORDER IN THE DATABASE (amount never comes from the
 * browser) and auto-submits it to NewebPay. Needs the order key. Also used for "重新付款" after a failure.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const key = new URL(req.url).searchParams.get('key') || ''
  const orderId = Number(id)
  const db = admin()
  const { data: o } = await db.from('orders').select('id,order_key,status,total,payment_method,billing_email').eq('id', orderId).maybeSingle()
  if (!o || !key || key !== o.order_key) return NextResponse.json({ ok: false, error: '找不到訂單。' }, { status: 404 })
  const received = new URL(`/checkout/order-received/${o.id}/?key=${encodeURIComponent(o.order_key)}`, req.url)
  const cfg = newebpayConfig()
  const gw = gatewayById(o.payment_method)
  if (!cfg || !gw || !gw.enabled || !NEEDS_PAYMENT.includes(o.status) || orderAmount(o.total) <= 0) return NextResponse.redirect(received, 303)

  const { data: items } = await db.from('order_items').select('name').eq('order_id', o.id).eq('item_type', 'line_item').order('id')
  const mon = generateMerchantOrderNo(o.id)
  try {
    await issueMerchantOrderNo(o.id, mon, gw.title, gw.noteLabel)
  } catch (e) {
    console.error('newebpay pay failed:', (e as Error).message)
    return NextResponse.json({ ok: false, error: '暫時無法前往付款，請稍後再試。' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  const base = baseUrl(req)
  const form = buildMpgForm(cfg, gw, { id: o.id, total: o.total, email: o.billing_email, itemNames: (items || []).map((i) => i.name) }, mon, {
    notifyUrl: `${base}/api/newebpay/notify`,
    returnUrl: `${base}/api/newebpay/return`,
    customerUrl: `${base}/api/newebpay/customer`,
    clientBackUrl: `${base}/checkout/order-received/${o.id}/?key=${encodeURIComponent(o.order_key)}`,
  })
  const inputs = Object.entries(form.fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`).join('')
  const html = `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>前往藍新金流付款…</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 16px"><p>正在前往藍新金流付款頁面，請稍候…</p>
<form id="nwp" method="post" action="${esc(form.action)}">${inputs}<button type="submit">若未自動跳轉，請按此前往付款</button></form>
<script>document.getElementById('nwp').submit()</script></body></html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } })
}
