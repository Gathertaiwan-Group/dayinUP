import { NextResponse } from 'next/server'
import { authClient, customerFor } from '@/lib/auth'
import { admin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  let login = String(b.login || b.username || '').trim()
  const password = String(b.password || '')
  if (!login || !password) return NextResponse.json({ ok: false, error: '請輸入使用者名稱或電子郵件與密碼。' }, { status: 400 })
  if (!login.includes('@')) {
    const { data } = await admin().from('customers').select('email').ilike('username', login).limit(1)
    if (!data?.[0]?.email) return NextResponse.json({ ok: false, error: '使用者名稱或密碼不正確。' }, { status: 401 })
    login = data[0].email
  }
  const sb = await authClient()
  const { data, error } = await sb.auth.signInWithPassword({ email: login, password })
  if (error || !data.user) return NextResponse.json({ ok: false, error: '使用者名稱或密碼不正確。' }, { status: 401 })
  await customerFor(data.user).catch(() => null)
  return NextResponse.json({ ok: true, message: '登入成功，正在重新整理…' })
}
