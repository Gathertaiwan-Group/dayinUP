import { NextResponse } from 'next/server'
import { authClient, customerFor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const next = url.searchParams.get('next') || '/my-account/'
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/my-account/'
  const code = url.searchParams.get('code')
  const sb = await authClient()
  if (code) {
    const { data } = await sb.auth.exchangeCodeForSession(code)
    if (data.user) await customerFor(data.user).catch(() => null)
  } else {
    const token_hash = url.searchParams.get('token_hash')
    const type = url.searchParams.get('type') as 'magiclink' | 'recovery' | 'signup' | 'email' | null
    if (token_hash && type) {
      const { data } = await sb.auth.verifyOtp({ token_hash, type })
      if (data.user) await customerFor(data.user).catch(() => null)
    }
  }
  return NextResponse.redirect(new URL(safeNext, url.origin))
}
