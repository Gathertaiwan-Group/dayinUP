import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { getCartRow, summarize } from '@/lib/cart'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [user, cart] = await Promise.all([currentUser(), getCartRow(false).then(summarize)])
  return NextResponse.json({
    ok: true,
    user: user ? { email: user.email, username: user.user_metadata?.username || user.email?.split('@')[0] } : null,
    cart: { count: cart.count, total: cart.total },
  })
}
