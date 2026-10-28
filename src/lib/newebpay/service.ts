/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only'
import { revalidatePath, revalidateTag } from 'next/cache'
import { admin } from '@/lib/supabase'
import { configFromEnv, enabledGateways, HOLD_STOCK_MINUTES, type NewebpayConfig, type PaymentStore, type StoreOrder } from './core'

export function newebpayConfig(): NewebpayConfig | null {
  return configFromEnv(process.env)
}

/** Payment methods shown at checkout (empty when NEWEBPAY_* is not set). */
export function publicGateways() {
  return enabledGateways(newebpayConfig()).map(({ id, title, description }) => ({ id, title, description }))
}

/** Base URL for Notify/Return URLs: NEWEBPAY_BASE_URL if set, else the origin of the incoming request. */
export function baseUrl(req: Request): string {
  const fixed = (process.env.NEWEBPAY_BASE_URL || '').trim().replace(/\/$/, '')
  return fixed || new URL(req.url).origin
}

function refresh() {
  try {
    revalidateTag('site', { expire: 0 })
    revalidatePath('/', 'layout')
  } catch {
    /* outside a Next request */
  }
}

async function auditRow(action: string, entityId: number | null, before: unknown, after: unknown) {
  const { error } = await admin().from('audit_log').insert({
    actor: 'newebpay', via: 'system', action, entity_type: 'orders', entity_id: entityId === null ? null : String(entityId), before: before ?? null, after: after ?? null,
  })
  if (error) console.error('audit_log insert failed:', error.message)
}

async function note(orderId: number, text: string) {
  await admin().from('order_notes').insert({ order_id: orderId, note: text, added_by: 'system' })
}

/** Decrement one stock row with compare-and-set (safe against concurrent orders). Returns [old, new] or null. */
async function casDecrement(table: 'products' | 'product_variations', id: number, qty: number): Promise<[number, number] | null> {
  const db = admin()
  for (let i = 0; i < 5; i++) {
    const { data: cur } = await db.from(table).select('stock_quantity,backorders').eq('id', id).single()
    if (!cur || cur.stock_quantity === null) return null
    const old = Number(cur.stock_quantity)
    const next = old - qty
    const patch: Record<string, unknown> = { stock_quantity: next }
    if (next <= 0) patch.stock_status = cur.backorders && cur.backorders !== 'no' ? 'onbackorder' : 'outofstock'
    const { data: upd } = await db.from(table).update(patch).eq('id', id).eq('stock_quantity', old).select('id')
    if (upd && upd.length) return [old, next]
  }
  return null
}

export const supabaseStore: PaymentStore = {
  async getOrder(id) {
    const { data } = await admin().from('orders').select('id,status,total,payment_method,stock_reduced,meta').eq('id', id).maybeSingle()
    return (data as StoreOrder) || null
  },
  async casStatus(id, from, to, patch) {
    const { data, error } = await admin()
      .from('orders')
      .update({ ...patch, status: to, date_modified: new Date().toISOString() })
      .eq('id', id)
      .in('status', from)
      .select('id')
    if (error) throw new Error(error.message)
    return !!data?.length
  },
  async claimStockReduction(id) {
    const { data, error } = await admin().from('orders').update({ stock_reduced: true }).eq('id', id).eq('stock_reduced', false).select('id')
    if (error) throw new Error(error.message)
    return !!data?.length
  },
  async reduceStock(orderId) {
    const db = admin()
    const { data: items } = await db.from('order_items').select('id,name,product_id,variation_id,quantity,meta').eq('order_id', orderId).eq('item_type', 'line_item')
    const lines: string[] = []
    for (const it of items || []) {
      const qty = Number(it.quantity) || 0
      if (!qty) continue
      let target: { table: 'products' | 'product_variations'; id: number } | null = null
      if (it.variation_id) {
        const { data: v } = await db.from('product_variations').select('id,manage_stock').eq('id', it.variation_id).maybeSingle()
        if (v?.manage_stock) target = { table: 'product_variations', id: v.id }
      }
      if (!target && it.product_id) {
        const { data: p } = await db.from('products').select('id,manage_stock').eq('id', it.product_id).maybeSingle()
        if (p?.manage_stock) target = { table: 'products', id: p.id }
      }
      if (!target) continue
      const r = await casDecrement(target.table, target.id, qty)
      if (!r) continue
      lines.push(`${it.name} (#${target.id}) ${r[0]}→${r[1]}`)
      await db.from('order_items').update({ meta: { ...(it.meta || {}), _reduced_stock: qty } }).eq('id', it.id)
    }
    if (lines.length) refresh()
    return lines
  },
  async mergeMeta(id, nwp) {
    const db = admin()
    const { data } = await db.from('orders').select('meta').eq('id', id).single()
    const meta = data?.meta || {}
    await db.from('orders').update({ meta: { ...meta, newebpay: { ...(meta.newebpay || {}), ...nwp } } }).eq('id', id)
  },
  addNote: note,
  audit: auditRow,
  async logNotification(row) {
    const { error } = await admin().from('payment_notifications').insert({ gateway: 'newebpay', ...row })
    if (error) console.error('payment_notifications insert failed:', error.message)
  },
}

/** Record a newly issued MerchantOrderNo on the order (a retry after failure issues a new one). */
export async function issueMerchantOrderNo(orderId: number, merchantOrderNo: string, gatewayTitle: string, noteLabel: string) {
  const db = admin()
  const { data } = await db.from('orders').select('meta').eq('id', orderId).single()
  const meta = data?.meta || {}
  const prev = meta.newebpay || {}
  const nos: string[] = [...(prev.merchant_order_nos || []), merchantOrderNo].slice(-20)
  await db.from('orders').update({ meta: { ...meta, newebpay: { ...prev, merchant_order_nos: nos, last_merchant_order_no: merchantOrderNo } }, date_modified: new Date().toISOString() }).eq('id', orderId)
  await note(orderId, `使用 ${noteLabel} 付款`)
  await auditRow('newebpay_redirect', orderId, null, { merchant_order_no: merchantOrderNo, gateway: gatewayTitle })
}

/**
 * WooCommerce wc_cancel_unpaid_orders(): pending checkout orders not modified for hold_stock_minutes are cancelled.
 * Limited to NewebPay orders so the manual 待付款 fallback orders keep their old behaviour.
 */
export async function cancelUnpaidOrders(): Promise<number> {
  if (!newebpayConfig()) return 0
  const db = admin()
  const cutoff = new Date(Date.now() - HOLD_STOCK_MINUTES * 60_000).toISOString()
  const { data } = await db
    .from('orders')
    .select('id')
    .eq('status', 'pending')
    .eq('created_via', 'checkout')
    .like('payment_method', 'ry_newebpay%')
    .lt('date_modified', cutoff)
    .limit(50)
  let n = 0
  for (const o of data || []) {
    const { data: upd } = await db.from('orders').update({ status: 'cancelled', date_modified: new Date().toISOString() }).eq('id', o.id).eq('status', 'pending').lt('date_modified', cutoff).select('id')
    if (!upd?.length) continue
    n++
    await note(o.id, '未付款訂單已取消 - 付款期限已過。 訂單狀態由 等待付款中 變更為 已取消.')
    await auditRow('unpaid_cancelled', o.id, { status: 'pending' }, { status: 'cancelled', hold_stock_minutes: HOLD_STOCK_MINUTES })
  }
  return n
}

/**
 * WooCommerce hold stock: quantities in NewebPay orders still awaiting payment (pending, within the hold window)
 * count as reserved. Returns an error message for the first line that cannot be fulfilled, else null.
 */
export async function reservedStockError(items: { product_id: number; variation_id: number | null; quantity: number; name: string }[]): Promise<string | null> {
  const db = admin()
  const cutoff = new Date(Date.now() - HOLD_STOCK_MINUTES * 60_000).toISOString()
  const pids = [...new Set(items.map((i) => i.product_id))]
  const vids = [...new Set(items.map((i) => i.variation_id).filter((x): x is number => !!x))]
  const [ps, vs] = await Promise.all([
    db.from('products').select('id,manage_stock,stock_quantity,backorders').in('id', pids),
    vids.length ? db.from('product_variations').select('id,manage_stock,stock_quantity,backorders').in('id', vids) : Promise.resolve({ data: [] as any[] }),
  ])
  const pm = new Map((ps.data || []).map((r: any) => [r.id, r]))
  const vm = new Map((vs.data || []).map((r: any) => [r.id, r]))
  const need = new Map<string, { row: any; qty: number; name: string; col: 'product_id' | 'variation_id'; id: number }>()
  for (const i of items) {
    const v = i.variation_id ? vm.get(i.variation_id) : null
    const useVar = v && v.manage_stock
    const row = useVar ? v : pm.get(i.product_id)
    if (!row || !row.manage_stock || row.stock_quantity === null || row.backorders !== 'no') continue
    const key = useVar ? `v${v.id}` : `p${row.id}`
    const cur = need.get(key)
    need.set(key, { row, qty: (cur?.qty || 0) + i.quantity, name: i.name, col: useVar ? 'variation_id' : 'product_id', id: row.id })
  }
  if (!need.size) return null
  const { data: held } = await db
    .from('orders')
    .select('id,order_items(product_id,variation_id,quantity,item_type)')
    .eq('status', 'pending')
    .like('payment_method', 'ry_newebpay%')
    .gte('date_modified', cutoff)
    .limit(500)
  for (const n of need.values()) {
    let reserved = 0
    for (const o of held || []) for (const it of (o as any).order_items || []) if (it.item_type === 'line_item' && Number(it[n.col]) === n.id) reserved += Number(it.quantity) || 0
    const left = Number(n.row.stock_quantity) - reserved
    if (n.qty > left) return `很抱歉，我們沒有足夠的「${n.name}」庫存來完成您的訂單（剩餘 ${Math.max(0, left)} 個）。造成不便，敬請見諒。`
  }
  return null
}
