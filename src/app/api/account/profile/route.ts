import { NextResponse } from 'next/server'
import { currentUser, customerFor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ ok: true, user: null })
  const c = await customerFor(user)
  return NextResponse.json({
    ok: true,
    user: { email: user.email, username: c.username, first_name: c.first_name, last_name: c.last_name, display_name: c.display_name, billing: c.billing || {} },
  })
}
