// DB integration tests for site_dayinup.expire_unpaid_holds (pg_cron job site_dayinup_expire_holds; holds measured from
// date_created), checkout_guard unpaid caps, and the orders_sync_stock trigger (stock_reduced + new status decide whether
// stock is reduced / restored, each exactly once).
// Runs only when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (skipped otherwise).
// Test data uses FIXED ids only (products 990000901-902, variation 990000911, orders 990000921-990000960), all deleted
// afterwards; every real product / variation stock row plus the order count and max order id are compared before and after.
// Run DB files serially (node --test --test-concurrency=1) so the order count is not disturbed by the other DB test file.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const skip = !URL_ || !KEY ? 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set' : false
const db = skip ? null : createClient(URL_, KEY, { db: { schema: 'site_dayinup' }, auth: { persistSession: false } })

const P_SIMPLE = 990_000_901
const P_VAR = 990_000_902
const V_ID = 990_000_911
const ORDER_IDS = Array.from({ length: 40 }, (_, i) => 990_000_921 + i)
let nextOrder = 0
const EMAIL = 'holds-dbtest@example.invalid'
const IP = '198.51.100.77'
const GUARD_EMAILS = ['holds-guard1@example.invalid', 'holds-guard2@example.invalid']

async function stockSnapshot() {
  const all = async (table) => {
    const rows = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select('id,stock_quantity,stock_status').order('id').range(from, from + 999)
      if (error) throw new Error(error.message)
      rows.push(...data)
      if (data.length < 1000) break
    }
    return rows.filter((r) => r.id < 990_000_000).map((r) => `${r.id}:${r.stock_quantity}:${r.stock_status}`).join(',')
  }
  const cnt = await db.from('orders').select('id', { count: 'exact', head: true })
  const max = await db.from('orders').select('id').lt('id', 990_000_000).order('id', { ascending: false }).limit(1)
  const maxAll = await db.from('orders').select('id').order('id', { ascending: false }).limit(1)
  return { products: await all('products'), variations: await all('product_variations'), orders: cnt.count, maxOrderId: max.data[0]?.id, maxOrderIdAll: maxAll.data[0]?.id }
}

async function cleanup() {
  await db.from('orders').delete().in('id', ORDER_IDS) // cascades items / notes
  await db.from('audit_log').delete().eq('entity_type', 'orders').in('entity_id', ORDER_IDS.map(String))
  await db.from('checkout_attempts').delete().in('email', GUARD_EMAILS)
  await db.from('product_variations').delete().eq('id', V_ID)
  await db.from('products').delete().in('id', [P_SIMPLE, P_VAR])
}

let snap
before(async () => {
  if (skip) return
  await cleanup() // leftovers of an aborted run
  snap = await stockSnapshot()
  let r = await db.from('products').insert([
    { id: P_SIMPLE, slug: 'holds-dbtest-simple', name: 'HOLDSTEST simple', status: 'draft', manage_stock: true, stock_quantity: 1, stock_status: 'instock', backorders: 'no' },
    { id: P_VAR, slug: 'holds-dbtest-var', name: 'HOLDSTEST variable', status: 'draft', manage_stock: false, stock_status: 'instock', backorders: 'no' },
  ])
  if (r.error) throw new Error(r.error.message)
  r = await db.from('product_variations').insert({ id: V_ID, product_id: P_VAR, manage_stock: true, stock_quantity: 5, stock_status: 'instock', backorders: 'no' })
  if (r.error) throw new Error(r.error.message)
})

after(async () => {
  if (skip) return
  await cleanup()
  const left = await db.from('orders').select('id').in('id', ORDER_IDS)
  assert.equal(left.data.length, 0, 'test orders deleted')
  assert.deepEqual(await stockSnapshot(), snap, 'stock of every real product / variation equals the pre-test snapshot')
  console.log(`# cleanup ok: test rows deleted; snapshot unchanged (orders=${snap.orders}, max id=${snap.maxOrderIdAll}, products=${snap.products.split(',').length}, variations=${snap.variations.split(',').length})`)
})

async function mkOrder(over = {}, lines = [{ product_id: P_SIMPLE, quantity: 2 }]) {
  const id = ORDER_IDS[nextOrder++]
  const { error } = await db.from('orders').insert({
    id, status: 'pending', total: 500, payment_method: 'ry_newebpay_credit', created_via: 'checkout', billing_email: EMAIL, customer_ip: IP,
    date_modified: new Date().toISOString(), meta: { source: 'holds-dbtest' }, ...over,
  })
  if (error) throw new Error(error.message)
  const li = await db.from('order_items').insert(lines.map((l) => ({ order_id: id, item_type: 'line_item', name: 'HOLDSTEST', subtotal: 250, total: 250, ...l })))
  if (li.error) throw new Error(li.error.message)
  return id
}
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()
const pStock = async () => (await db.from('products').select('stock_quantity,stock_status').eq('id', P_SIMPLE).single()).data
const vStock = async () => (await db.from('product_variations').select('stock_quantity').eq('id', V_ID).single()).data.stock_quantity
const order = async (id) => (await db.from('orders').select('status,stock_reduced,date_modified').eq('id', id).single()).data
const notes = async (id) => (await db.from('order_notes').select('note').eq('order_id', id)).data.map((n) => n.note)
const setStatus = async (id, status) => {
  const { error } = await db.from('orders').update({ status, date_modified: new Date().toISOString() }).eq('id', id)
  assert.equal(error, null)
}

test('expire_unpaid_holds: only NewebPay checkout orders created > 60 min ago are cancelled (note + audit)', { skip }, async () => {
  const old = await mkOrder({ date_created: minutesAgo(61), date_modified: minutesAgo(1) }) // recently touched: still expires
  const fresh = await mkOrder({ date_created: minutesAgo(30), date_modified: minutesAgo(30) })
  const manual = await mkOrder({ payment_method: 'pending', date_created: minutesAgo(120) }) // 待付款 fallback: untouched
  const admin = await mkOrder({ created_via: 'admin', date_created: minutesAgo(120) })
  const { data: n, error } = await db.rpc('expire_unpaid_holds', { p_hold_minutes: 60 })
  assert.equal(error, null)
  assert.ok(n >= 1)
  assert.equal((await order(old)).status, 'cancelled')
  assert.equal((await order(fresh)).status, 'pending')
  assert.equal((await order(manual)).status, 'pending')
  assert.equal((await order(admin)).status, 'pending')
  assert.ok((await notes(old)).some((t) => t.includes('付款期限已過')))
  const a = await db.from('audit_log').select('action').eq('entity_type', 'orders').eq('entity_id', String(old))
  assert.deepEqual(a.data.map((r) => r.action), ['unpaid_cancelled'])
  // idempotent: a second run changes nothing for these orders
  await db.rpc('expire_unpaid_holds', { p_hold_minutes: 60 })
  assert.equal((await order(fresh)).status, 'pending')
  assert.equal((await notes(old)).filter((t) => t.includes('付款期限已過')).length, 1)
  assert.equal((await pStock()).stock_quantity, 1, 'expiry never touches stock (holds were never deducted)')
})

test('reopen cancelled → processing: stock reduced once without availability check; negative stock gets a note', { skip }, async () => {
  const id = await mkOrder({ status: 'cancelled' }) // 2 × simple (stock 1)
  await setStatus(id, 'processing')
  assert.deepEqual(await pStock(), { stock_quantity: -1, stock_status: 'outofstock' })
  assert.equal((await order(id)).stock_reduced, true)
  const ns = await notes(id)
  assert.ok(ns.some((t) => t.includes('補扣庫存') && t.includes('1→-1')), ns.join(' | '))
  assert.ok(ns.some((t) => t.includes('庫存不足') && t.includes('-1')), ns.join(' | '))
  // cancel restores once (-1 → 1), completing again reduces once (1 → -1)
  await setStatus(id, 'cancelled')
  assert.deepEqual(await pStock(), { stock_quantity: 1, stock_status: 'instock' })
  assert.equal((await order(id)).stock_reduced, false)
  await setStatus(id, 'completed')
  assert.equal((await pStock()).stock_quantity, -1)
  // restore for the next tests
  await db.from('products').update({ stock_quantity: 1, stock_status: 'instock' }).eq('id', P_SIMPLE)
})

test('reopen failed → completed (variation line): reduced once; processing → completed does not reduce', { skip }, async () => {
  const id = await mkOrder({ status: 'failed' }, [{ product_id: P_VAR, variation_id: V_ID, quantity: 3 }])
  await setStatus(id, 'completed')
  assert.equal(await vStock(), 2)
  assert.ok(!(await notes(id)).some((t) => t.includes('庫存不足')), 'no warning when stock stays >= 0')
  const id2 = await mkOrder({ status: 'processing' }, [{ product_id: P_VAR, variation_id: V_ID, quantity: 1 }])
  await setStatus(id2, 'completed') // not a reopen
  assert.equal(await vStock(), 2)
})

test('reopen of an order whose stock was already reduced (imported _order_stock_reduced=yes) does not reduce again', { skip }, async () => {
  const id = await mkOrder({ status: 'failed', stock_reduced: true })
  await setStatus(id, 'processing')
  assert.equal((await pStock()).stock_quantity, 1)
})

test('NewebPay paid on a cancelled order: stock reduced exactly once (apply, not apply + trigger)', { skip }, async () => {
  const id = await mkOrder({ status: 'cancelled' }, [{ product_id: P_SIMPLE, quantity: 1 }])
  const { data, error } = await db.rpc('newebpay_apply', { p_order_id: id, p_kind: 'paid', p_trade_no: 'HOLDSTEST1', p_info: {}, p_notes: ['付款完成'] })
  assert.equal(error, null)
  assert.equal(data.result, 'applied')
  assert.equal(data.stock_lines.length, 1)
  assert.equal((await pStock()).stock_quantity, 0)
  assert.equal((await order(id)).stock_reduced, true)
  assert.ok(!(await notes(id)).some((t) => t.includes('補扣庫存')), 'trigger did not fire for the NewebPay path')
})

// ---------------------------------------------------------------- round 3: hold by creation time, status-driven stock sync
const resetSimple = async () => assert.equal((await db.from('products').update({ stock_quantity: 1, stock_status: 'instock' }).eq('id', P_SIMPLE)).error, null)

test('repeated pay-page order-no issue does not extend the hold (expiry + reservation clock = date_created)', { skip }, async () => {
  await resetSimple() // earlier tests leave the simple product at 0
  const id = await mkOrder({ date_created: minutesAgo(61), date_modified: minutesAgo(61) })
  for (let i = 0; i < 3; i++) {
    const { data, error } = await db.rpc('newebpay_issue_order_no', { p_order_id: id, p_merchant_order_no: `${id}TSHOLD${i}` })
    assert.equal(error, null)
    assert.equal(data, true)
  }
  assert.ok(Date.parse((await order(id)).date_modified) > Date.now() - 60_000, 'issue bumped date_modified')
  await db.rpc('expire_unpaid_holds', { p_hold_minutes: 60 })
  assert.equal((await order(id)).status, 'cancelled', 'expired although date_modified is fresh')
  const fresh = await mkOrder({ date_created: minutesAgo(30) })
  await db.rpc('newebpay_issue_order_no', { p_order_id: fresh, p_merchant_order_no: `${fresh}TSHOLDF` })
  await db.rpc('expire_unpaid_holds', { p_hold_minutes: 60 })
  assert.equal((await order(fresh)).status, 'pending')
  assert.equal((await pStock()).stock_quantity, 1)
})

test('checkout_guard: unpaid cap counts pending + failed by date_created; re-issued old orders do not count', { skip }, async () => {
  const [E1, E2] = GUARD_EMAILS
  const g = (email) => db.rpc('checkout_guard', { p_ip: null, p_email: email })
  // 3 failed orders created now → capped (failed counts toward the cap)
  for (let i = 0; i < 3; i++) await mkOrder({ status: 'failed', billing_email: E1, customer_ip: null })
  assert.equal((await g(E1)).data, 'unpaid_email')
  // 3 pending orders created 61 min ago but touched now (pay page) → not counted
  for (let i = 0; i < 3; i++) await mkOrder({ billing_email: E2, customer_ip: null, date_created: minutesAgo(61), date_modified: new Date().toISOString() })
  const r = await g(E2)
  assert.equal(r.error, null)
  assert.equal(r.data, null)
})

test('cancelled → on-hold → processing: reduced exactly once (on entering on-hold)', { skip }, async () => {
  await resetSimple() // earlier tests leave the simple product at 0
  const id = await mkOrder({ status: 'cancelled' }, [{ product_id: P_SIMPLE, quantity: 1 }])
  await setStatus(id, 'on-hold')
  assert.deepEqual(await pStock(), { stock_quantity: 0, stock_status: 'outofstock' })
  assert.equal((await order(id)).stock_reduced, true)
  await setStatus(id, 'processing')
  assert.equal((await pStock()).stock_quantity, 0, 'on-hold → processing: no second reduction')
  await setStatus(id, 'completed')
  assert.equal((await pStock()).stock_quantity, 0)
  await db.from('products').update({ stock_quantity: 1, stock_status: 'instock' }).eq('id', P_SIMPLE)
})

test('refunded → processing: reduces only when stock is not already reduced', { skip }, async () => {
  await resetSimple() // earlier tests leave the simple product at 0
  const kept = await mkOrder({ status: 'refunded', stock_reduced: true }, [{ product_id: P_SIMPLE, quantity: 1 }])
  await setStatus(kept, 'processing')
  assert.equal((await pStock()).stock_quantity, 1, 'refund kept the stock reduced → no second reduction')
  const back = await mkOrder({ status: 'refunded' }, [{ product_id: P_SIMPLE, quantity: 1 }]) // restocked refund
  await setStatus(back, 'processing')
  assert.equal((await pStock()).stock_quantity, 0)
  assert.equal((await order(back)).stock_reduced, true)
  await setStatus(back, 'refunded') // refunded never moves stock
  assert.equal((await pStock()).stock_quantity, 0)
  await db.from('products').update({ stock_quantity: 1, stock_status: 'instock' }).eq('id', P_SIMPLE)
})

test('failed releases reduced stock once; a later NewebPay payment reduces again once', { skip }, async () => {
  const start = await vStock()
  const id = await mkOrder({}, [{ product_id: P_VAR, variation_id: V_ID, quantity: 2 }])
  await setStatus(id, 'processing')
  assert.equal(await vStock(), start - 2)
  await setStatus(id, 'failed')
  assert.equal(await vStock(), start, 'failed restored the stock')
  assert.equal((await order(id)).stock_reduced, false)
  assert.ok((await notes(id)).some((t) => t.includes('已歸還庫存')))
  const it = await db.from('order_items').select('meta').eq('order_id', id).single()
  assert.equal(it.data.meta._reduced_stock, undefined, '_reduced_stock cleared')
  await setStatus(id, 'cancelled') // failed → cancelled: nothing left to restore
  assert.equal(await vStock(), start)
  const { data, error } = await db.rpc('newebpay_apply', { p_order_id: id, p_kind: 'paid', p_trade_no: 'HOLDSTEST2', p_info: {}, p_notes: ['付款完成'] })
  assert.equal(error, null)
  assert.equal(data.result, 'applied')
  assert.equal(await vStock(), start - 2, 'paid after release: reduced once')
  // resend of the same notify: no further change
  await db.rpc('newebpay_apply', { p_order_id: id, p_kind: 'paid', p_trade_no: 'HOLDSTEST2', p_info: {}, p_notes: ['付款完成'] })
  assert.equal(await vStock(), start - 2)
  // NewebPay failure on a pending order (never reduced): no stock change
  const p = await mkOrder({}, [{ product_id: P_VAR, variation_id: V_ID, quantity: 1 }])
  await db.rpc('newebpay_apply', { p_order_id: p, p_kind: 'failed', p_trade_no: null, p_info: {}, p_notes: ['付款失敗'] })
  assert.equal((await order(p)).status, 'failed')
  assert.equal(await vStock(), start - 2)
})

test('processing → completed (and on-hold → completed) never reduces twice', { skip }, async () => {
  const start = await vStock()
  const id = await mkOrder({}, [{ product_id: P_VAR, variation_id: V_ID, quantity: 1 }])
  await setStatus(id, 'processing')
  await setStatus(id, 'completed')
  assert.equal(await vStock(), start - 1)
  const id2 = await mkOrder({}, [{ product_id: P_VAR, variation_id: V_ID, quantity: 1 }])
  const { error } = await db.rpc('newebpay_apply', { p_order_id: id2, p_kind: 'on-hold', p_trade_no: 'HOLDSTEST3', p_info: {}, p_notes: ['取號'] })
  assert.equal(error, null)
  assert.equal(await vStock(), start - 2)
  await setStatus(id2, 'completed')
  assert.equal(await vStock(), start - 2)
  // restore both so the next run starts clean (cancel restores once each)
  await setStatus(id, 'cancelled')
  await setStatus(id2, 'cancelled')
  assert.equal(await vStock(), start)
})
