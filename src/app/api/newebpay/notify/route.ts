import { processInbound } from '@/lib/newebpay/core'
import { newebpayConfig, supabaseStore } from '@/lib/newebpay/service'
import { readInbound } from '@/lib/newebpay/http'

export const dynamic = 'force-dynamic'

/**
 * NotifyURL (server-to-server, the only place an order becomes paid).
 * Verifies TradeSha + AES, MerchantID, issued MerchantOrderNo and amount; idempotent (status CAS + stock_reduced claim).
 */
export async function POST(req: Request) {
  const cfg = newebpayConfig()
  if (!cfg) return new Response('NOT CONFIGURED', { status: 503 })
  const body = await readInbound(req)
  try {
    const r = await processInbound(supabaseStore, cfg, body, 'notify')
    return new Response(r.http === 200 ? 'OK' : `ERROR ${r.outcome}`, { status: r.http, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('newebpay notify failed:', (e as Error).message)
    return new Response('ERROR', { status: 500 })
  }
}
