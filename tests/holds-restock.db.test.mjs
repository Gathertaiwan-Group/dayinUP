// DB integration tests for site_dayinup.expire_unpaid_holds (pg_cron job site_dayinup_expire_holds) and the
// orders_reduce_stock_on_reopen trigger (cancelled / failed → processing / completed reduces stock once).
// Runs only when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (skipped otherwise).
// Test data uses FIXED ids only (products 990000901-902, variation 990000911, orders 990000921-990000940), all deleted
// afterwards; a checksum of every product / variation stock row is compared before and after the run.
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
const ORDER_IDS = Array.from({ length: 20 }, (_, i) => 990_000_921 + i)
let nextOrder = 0
const EMAIL = 'holds-dbtest@example.invalid'
const IP = '198.51.100.77'

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
  return { products: await all('products'), variations: await all('product_variations') }
}

async function cleanup() {
  await db.from('orders').delete().in('id', ORDER_IDS) // cascades items / notes
  await db.from('audit_log').delete().eq('entity_type', 'orders').in('entity_id', ORDER_IDS.map(String))
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
  console.log('# cleanup ok: test rows deleted, real stock snapshot unchanged')
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
const order = async (id) => (await db.from('orders').select('status,stock_reduced').eq('id', id).single()).data
const notes = async (id) => (await db.from('order_notes').select('note').eq('order_id', id)).data.map((n) => n.note)
const setStatus = async (id, status) => {
  const { error } = await db.from('orders').update({ status, date_modified: new Date().toISOString() }).eq('id', id)
  assert.equal(error, null)
}

test('expire_unpaid_holds: only NewebPay checkout orders pending > 60 min are cancelled (note + audit)', { skip }, async () => {
  const old = await mkOrder({ date_modified: minutesAgo(61) })
  const fresh = await mkOrder({ date_modified: minutesAgo(30) })
  const manual = await mkOrder({ payment_method: 'pending', date_modified: minutesAgo(120) }) // 待付款 fallback: untouched
  const admin = await mkOrder({ created_via: 'admin', date_modified: minutesAgo(120) })
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
  // cancel again and complete again: already reduced → no second deduction
  await setStatus(id, 'cancelled')
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
