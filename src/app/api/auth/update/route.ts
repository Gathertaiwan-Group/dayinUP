import { NextResponse } from 'next/server'
import { authClient, currentUser, customerFor } from '@/lib/auth'
import { admin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/** 帳號詳細資料: names, display name, password change. */
export async function POST(req: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ ok: false, error: '請先登入。' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const c = await customerFor(user)
  const patch: Record<string, string> = {}
  for (const k of ['first_name', 'last_name', 'display_name']) if (typeof b[k] === 'string') patch[k] = b[k].trim().slice(0, 100)
  if (Object.keys(patch).length) await admin().from('customers').update({ ...patch, date_modified: new Date().toISOString() }).eq('id', c.id)
  if (b.billing && typeof b.billing === 'object') {
    const billing: Record<string, string> = {}
    for (const [k, v] of Object.entries(b.billing)) if (typeof v === 'string') billing[k] = v.slice(0, 300)
    await admin().from('customers').update({ billing, date_modified: new Date().toISOString() }).eq('id', c.id)
  }
  if (b.password_1) {
    if (String(b.password_1).length < 8) return NextResponse.json({ ok: false, error: '密碼至少需 8 個字元。' }, { status: 400 })
    if (b.password_1 !== b.password_2) return NextResponse.json({ ok: false, error: '兩次輸入的新密碼不一致。' }, { status: 400 })
    const sb = await authClient()
    const { error } = await sb.auth.updateUser({ password: String(b.password_1) })
    if (error) return NextResponse.json({ ok: false, error: '密碼更新失敗：' + error.message }, { status: 400 })
  }
  return NextResponse.json({ ok: true, message: '帳號資料已成功變更。' })
}
