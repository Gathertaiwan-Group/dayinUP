import { NextResponse } from 'next/server'
import { authClient } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const sb = await authClient()
  await sb.auth.signOut()
  return NextResponse.json({ ok: true })
}
