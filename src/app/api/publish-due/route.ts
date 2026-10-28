import { NextResponse } from 'next/server'
import { publishDue } from '@/lib/schedule'
import { cancelUnpaidOrders } from '@/lib/newebpay/service'

export const dynamic = 'force-dynamic'

/**
 * Promotes scheduled ("future") posts/products whose date has passed and, when anything changed, expires the ISR
 * page cache. Pinged by src/proxy.ts at most once a minute per instance (public pages are static, so the promotion
 * can no longer run inside the page render). Idempotent and throttled; returns only a count.
 */
export async function GET() {
  const promoted = await publishDue() // calls refreshSite() itself when rows were promoted
  // WooCommerce hold-stock cron: cancel NewebPay orders left unpaid for 60 minutes (no-op without NEWEBPAY_*)
  const cancelled = await cancelUnpaidOrders().catch(() => 0)
  return NextResponse.json({ promoted, cancelled }, { headers: { 'Cache-Control': 'no-store' } })
}
