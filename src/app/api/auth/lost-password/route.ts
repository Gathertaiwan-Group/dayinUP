import { NextResponse } from 'next/server'
import { authClient } from '@/lib/auth'
import { admin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  let email = String(b.user_login || '').trim()
  if (!email) return NextResponse.json({ ok: false, error: '請輸入使用者名稱或電子郵件地址。' }, { status: 400 })
  if (!email.includes('@')) {
    const { data } = await admin().from('customers').select('email').ilike('username', email).limit(1)
    email = data?.[0]?.email || ''
  }
  const form = await admin().from('forms').select('id').eq('slug', 'lostpasswordform').maybeSingle()
  if (form.data) await admin().from('form_submissions').insert({ form_id: form.data.id, data: { user_login: String(b.user_login).slice(0, 200) }, source_url: req.headers.get('referer') })
  if (email) {
    const sb = await authClient()
    await sb.auth.resetPasswordForEmail(email, { redirectTo: `${new URL(req.url).origin}/api/auth/callback/?next=/my-account/edit-account/` })
  }
  // same answer either way (no account enumeration)
  return NextResponse.json({ ok: true, message: '若此帳號存在，重設密碼連結已寄送到註冊信箱。' })
}
