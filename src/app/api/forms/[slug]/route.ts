/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { admin } from '@/lib/supabase'
import { currentUser, customerFor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const SECRET_FIELDS = /pass|pwd|token|nonce|card|cvc|cvv/i
const MESSAGES: Record<string, string> = {
  commentform: '感謝您的留言，留言將在審核後顯示。',
  'elementor-form': '已成功訂閱，感謝您！',
}

/** Stores any front-end form submission into site_dayinup.form_submissions (passwords are never stored). */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const ct = req.headers.get('content-type') || ''
  let body: Record<string, any> = {}
  if (ct.includes('application/json')) body = await req.json().catch(() => ({}))
  else {
    const fd = await req.formData().catch(() => null)
    if (fd) fd.forEach((v, k) => { if (typeof v === 'string') body[k] = v })
  }
  if (body.website_hp) return NextResponse.json({ ok: true }) // honeypot
  const db = admin()
  const { data: form } = await db.from('forms').select('id,slug,form_type,fields').eq('slug', slug).eq('status', 'published').maybeSingle()
  if (!form) return NextResponse.json({ ok: false, error: '找不到表單。' }, { status: 404 })

  const data: Record<string, any> = {}
  for (const [k, v] of Object.entries(body)) {
    if (SECRET_FIELDS.test(k) || k.startsWith('__')) continue
    data[k] = typeof v === 'string' ? v.slice(0, 5000) : v
  }
  // required-field validation from the stored form definition
  const missing = (form.fields || []).filter((f: any) => f.required && f.name && !String(body[f.name] ?? '').trim()).map((f: any) => (f.label || f.name).replace(/\s*\*\s*$/, ''))
  if (missing.length) return NextResponse.json({ ok: false, error: `請填寫必填欄位：${missing.join('、')}` }, { status: 400 })
  const email = String(body.email || body['form_fields[email]'] || body.user_email || '')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: '請輸入有效的電子郵件地址。' }, { status: 400 })

  const user = await currentUser()
  const customer = user ? await customerFor(user).catch(() => null) : null
  const page = String(body.__page || '').slice(0, 500)
  const ins = await db
    .from('form_submissions')
    .insert({
      form_id: form.id,
      data,
      source_url: page || req.headers.get('referer') || null,
      ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
      user_agent: (req.headers.get('user-agent') || '').slice(0, 500),
      customer_id: customer?.id ?? null,
    })
    .select('id')
    .single()
  if (ins.error) return NextResponse.json({ ok: false, error: '送出失敗，請稍後再試。' }, { status: 500 })

  if (slug === 'commentform' && body.comment_post_ID) {
    await db.from('comments').insert({
      post_id: Number(body.comment_post_ID),
      parent_id: Number(body.comment_parent) || null,
      author_name: String(body.author || '').slice(0, 200),
      author_email: String(body.email || '').slice(0, 200),
      author_url: String(body.url || '').slice(0, 300) || null,
      author_ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
      user_agent: (req.headers.get('user-agent') || '').slice(0, 500),
      content_html: String(body.comment || '').replace(/[<>]/g, '').slice(0, 5000),
      status: 'hold',
      meta: { submission_id: ins.data.id },
    })
  }
  return NextResponse.json({ ok: true, id: ins.data.id, message: MESSAGES[slug] || '已送出，謝謝！' })
}
