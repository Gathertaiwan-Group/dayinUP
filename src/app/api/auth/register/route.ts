import { NextResponse } from 'next/server'
import { authClient } from '@/lib/auth'
import { admin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * WordPress/Blocksy registration asks only for username + email and mails a link to set the password.
 * Equivalent here: Supabase magic link (signInWithOtp, creates the user) → /api/auth/callback → /my-account/.
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const username = String(b.username || '').trim().slice(0, 60)
  const email = String(b.email || '').trim().toLowerCase()
  if (!username) return NextResponse.json({ ok: false, error: '請輸入使用者名稱。' }, { status: 400 })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: '請輸入有效的電子郵件地址。' }, { status: 400 })
  const origin = new URL(req.url).origin
  const sb = await authClient()
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, data: { username, site: 'dayinup' }, emailRedirectTo: `${origin}/api/auth/callback/?next=/my-account/` },
  })
  // keep a registration record like WP would (no password stored)
  const form = await admin().from('forms').select('id').eq('slug', 'registerform').maybeSingle()
  if (form.data) {
    await admin().from('form_submissions').insert({
      form_id: form.data.id,
      data: { user_login: username, user_email: email, attribution: b.attribution || {}, result: error ? 'error' : 'link_sent' },
      source_url: req.headers.get('referer'),
      user_agent: (req.headers.get('user-agent') || '').slice(0, 500),
    })
  }
  if (error) return NextResponse.json({ ok: false, error: '註冊失敗：' + error.message }, { status: 400 })
  return NextResponse.json({ ok: true, message: '註冊確認信已寄出，請至信箱點擊連結完成註冊並登入。' })
}
