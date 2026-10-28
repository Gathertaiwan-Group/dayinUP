// DB integration tests for the NewebPay SQL functions (site_dayinup.newebpay_issue_order_no / newebpay_apply / checkout_guard).
// Runs only when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are in the environment (skipped otherwise, e.g. in CI).
// Creates a draft test product + test orders (TEST-NET IPs, *.invalid e-mails) and deletes everything it created.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const skip = !URL_ || !KEY ? 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set' : false
const db = skip ? null : createClient(URL_, KEY, { db: { schema: 'site_dayinup' }, auth: { persistSession: false } })

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const PRODUCT_ID = 990_000_000 + Math.floor(Math.random() * 999_999)
const IP = `203.0.113.${1 + Math.floor(Math.random() * 250)}`
const EMAIL = `nwp-dbtest-${RUN}@example.invalid`
const created = []

async function mkOrder(over = {}) {
  const { data, error } = await db
    .from('orders')
    .insert({ status: 'pending', total: 600, payment_method: 'ry_newebpay_credit', created_via: 'checkout', billing_email: EMAIL, customer_ip: IP, date_modified: new Date().toISOString(), meta: { source: 'dbtest', run: RUN }, ...over })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  created.push(data.id)
  const li = await db.from('order_items').insert({ order_id: data.id, item_type: 'line_item', name: `DBTEST ${RUN}`, product_id: PRODUCT_ID, quantity: 2, subtotal: 600, total: 600 })
  if (li.error) throw new Error(li.error.message)
  return data.id
}
const stock = async () => (await db.from('products').select('stock_quantity').eq('id', PRODUCT_ID).single()).data.stock_quantity

before(async () => {
  if (skip) return
  const { error } = await db.from('products').insert({ id: PRODUCT_ID, slug: `nwp-dbtest-${RUN}`, name: `DBTEST ${RUN}`, status: 'draft', manage_stock: true, stock_quantity: 10, backorders: 'no' })
  if (error) throw new Error(error.message)
})

after(async () => {
  if (skip) return
  if (created.length) await db.from('orders').delete().in('id', created) // cascades items / notes / payment_notifications
  await db.from('products').delete().eq('id', PRODUCT_ID)
  await db.from('checkout_attempts').delete().or(`ip.eq.${IP},email.eq.${EMAIL}`)
})

test('issue_order_no: 25 concurrent calls → every number recorded (newest 20 kept), none lost', { skip }, async () => {
  const id = await mkOrder()
  const nos = Array.from({ length: 25 }, (_, i) => `${id}TS${i}${RUN}`.slice(0, 30))
  const rs = await Promise.all(nos.map((n) => db.rpc('newebpay_issue_order_no', { p_order_id: id, p_merchant_order_no: n })))
  for (const r of rs) assert.equal(r.error, null)
  const { data } = await db.from('orders').select('meta').eq('id', id).single()
  const kept = data.meta.newebpay.merchant_order_nos
  assert.equal(kept.length, 20)
  assert.equal(new Set(kept).size, 20) // no duplicates, nothing overwritten
  for (const n of kept) assert.ok(nos.includes(n))
  assert.equal(data.meta.run, RUN) // other meta keys survive
  // 10 concurrent on a fresh order: all 10 present
  const id2 = await mkOrder()
  const ten = Array.from({ length: 10 }, (_, i) => `${id2}TS${i}x`)
  await Promise.all(ten.map((n) => db.rpc('newebpay_issue_order_no', { p_order_id: id2, p_merchant_order_no: n })))
  const d2 = (await db.from('orders').select('meta').eq('id', id2).single()).data
  assert.deepEqual([...d2.meta.newebpay.merchant_order_nos].sort(), [...ten].sort())
  assert.equal((await db.rpc('newebpay_issue_order_no', { p_order_id: -1, p_merchant_order_no: 'x' })).data, false)
})

test('apply paid: concurrent same notify → one applied, stock reduced once, trade data + notes written together', { skip }, async () => {
  const id = await mkOrder()
  const before = await stock()
  const args = { p_order_id: id, p_kind: 'paid', p_trade_no: `T${RUN}`, p_info: { trade_no: `T${RUN}`, card4: '1111' }, p_notes: ['付款完成', '訂單狀態由 {from} 變更為 處理中.'] }
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => db.rpc('newebpay_apply', args)))
  for (const r of rs) assert.equal(r.error, null)
  const results = rs.map((r) => r.data.result).sort()
  assert.deepEqual(results, ['applied', 'same', 'same', 'same', 'same'])
  assert.equal(await stock(), before - 2)
  const { data: o } = await db.from('orders').select('status,transaction_id,date_paid,stock_reduced,meta').eq('id', id).single()
  assert.equal(o.status, 'processing')
  assert.equal(o.transaction_id, `T${RUN}`)
  assert.ok(o.date_paid)
  assert.equal(o.stock_reduced, true)
  assert.equal(o.meta.newebpay.card4, '1111')
  const { data: notes } = await db.from('order_notes').select('note').eq('order_id', id).order('id')
  assert.deepEqual(notes.map((n) => n.note).slice(0, 2), ['付款完成', '訂單狀態由 等待付款中 變更為 處理中.'])
  assert.match(notes[2].note, /^庫存量已減少： DBTEST .* 10→8|^庫存量已減少： /)
  // a different trade on the paid order → 'other', nothing changes
  const other = await db.rpc('newebpay_apply', { ...args, p_trade_no: 'OTHER' })
  assert.equal(other.data.result, 'other')
  assert.equal(await stock(), before - 2)
})

test('apply: legacy partial (processing, same trade, stock not reduced) → completed once', { skip }, async () => {
  const id = await mkOrder({ status: 'processing', meta: { run: RUN, newebpay: { trade_no: `L${RUN}` } } })
  const s0 = await stock()
  const args = { p_order_id: id, p_kind: 'paid', p_trade_no: `L${RUN}`, p_info: {}, p_notes: ['付款完成'] }
  assert.equal((await db.rpc('newebpay_apply', args)).data.result, 'completed')
  assert.equal((await db.rpc('newebpay_apply', args)).data.result, 'same')
  assert.equal(await stock(), s0 - 2)
})

test('apply failed: pending → failed, no stock change; resend ignored', { skip }, async () => {
  const id = await mkOrder()
  const s0 = await stock()
  const args = { p_order_id: id, p_kind: 'failed', p_trade_no: null, p_info: { status: 'MPG03009' }, p_notes: ['付款失敗： x (MPG03009) 訂單狀態由 {from} 變更為 失敗.'] }
  assert.equal((await db.rpc('newebpay_apply', args)).data.result, 'applied')
  assert.notEqual((await db.rpc('newebpay_apply', args)).data.result, 'applied')
  assert.equal(await stock(), s0)
  assert.equal((await db.from('orders').select('status').eq('id', id).single()).data.status, 'failed')
})

test('checkout_guard: rate limit per IP, unpaid cap per e-mail; anon cannot call it', { skip }, async () => {
  // unpaid cap: this file already created pending NewebPay orders for EMAIL; make sure there are >= 3 pending
  const { count } = await db.from('orders').select('id', { count: 'exact', head: true }).eq('billing_email', EMAIL).eq('status', 'pending')
  for (let i = count; i < 3; i++) await mkOrder()
  const g = (ip, email, extra = {}) => db.rpc('checkout_guard', { p_ip: ip, p_email: email, ...extra })
  assert.equal((await g(null, EMAIL)).data, 'unpaid_email')
  assert.equal((await g(IP, null, { p_max_unpaid_ip: 2 })).data, 'unpaid_ip')
  // rate limit: a fresh e-mail + fresh TEST-NET IP (no pending orders) → 3 allowed, 4th blocked
  const ip2 = `198.51.100.${1 + Math.floor(Math.random() * 250)}`
  const em2 = `nwp-dbtest-${RUN}-rate@example.invalid`
  const outs = []
  for (let i = 0; i < 4; i++) outs.push((await g(ip2, em2, { p_max_attempts_ip: 3 })).data)
  assert.deepEqual(outs, [null, null, null, 'rate_ip'])
  await db.from('checkout_attempts').delete().or(`ip.eq.${ip2},email.eq.${em2}`)
  const anon = createClient(URL_, process.env.SUPABASE_ANON_KEY || 'x', { db: { schema: 'site_dayinup' }, auth: { persistSession: false } })
  const a = await anon.rpc('checkout_guard', { p_ip: '1', p_email: null })
  assert.ok(a.error, 'anon must not execute checkout_guard')
  const b = await anon.rpc('newebpay_apply', { p_order_id: 1, p_kind: 'paid', p_trade_no: null, p_info: {}, p_notes: [] })
  assert.ok(b.error, 'anon must not execute newebpay_apply')
})
