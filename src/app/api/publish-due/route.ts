import { NextResponse } from 'next/server'
import { publishDue } from '@/lib/schedule'

export const dynamic = 'force-dynamic'

/**
 * Promotes scheduled ("future") posts/products whose date has passed and, when anything changed, expires the ISR
 * page cache. Pinged by src/proxy.ts at most once a minute per instance (public pages are static, so the promotion
 * can no longer run inside the page render). Idempotent and throttled; returns only a count.
 */
export async function GET() {
  const promoted = await publishDue() // calls refreshSite() itself when rows were promoted
  return NextResponse.json({ promoted }, { headers: { 'Cache-Control': 'no-store' } })
}
