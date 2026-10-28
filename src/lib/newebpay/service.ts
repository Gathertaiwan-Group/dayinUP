/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only'
import { revalidatePath, revalidateTag } from 'next/cache'
import { admin } from '@/lib/supabase'
import { configFromEnv, enabledGateways, guardMessage, HOLD_STOCK_MINUTES, testModeBlocked, TEST_MODE_BLOCKED_MESSAGE, type ApplyResult, type NewebpayConfig, type PaymentStore, type StoreOrder } from './core'

/** true when this production deployment carries NEWEBPAY_ENV=test (NewebPay is then fully disabled, see core.testModeBlocked). */
export function newebpayTestModeBlocked(): boolean {
  return testModeBlocked(process.env)
}

let lastBlockedAlert = 0
/**
 * Log + admin alert (audit_log action newebpay_test_mode_blocked, shown on /admin/audit and as a banner on every admin
 * page) for the production/test-key misconfiguration. Inbound/payment paths pass force=true so every refused attempt is
 * recorded; page renders are throttled to one row per 10 minutes per instance.
 */
export async function alertTestModeBlocked(where: string, detail: Record<string, unknown> = {}, force = false): Promise<void> {
  console.error(`[newebpay] ${where}: ${TEST_MODE_BLOCKED_MESSAGE}`)
  const now = Date.now()
  if (!force && now - lastBlockedAlert < 10 * 60_000) return
  lastBlockedAlert = now
  try {
    const { error } = await admin().from('audit_log').insert({
      actor: 'newebpay', via: 'system', action: 'newebpay_test_mode_blocked', entity_type: 'settings', entity_id: 'newebpay',
      before: null, after: { where, vercel_env: 'production', newebpay_env: 'test', ...detail },
    })
    if (error) console.error('audit_log insert failed:', error.message)
  } catch (e) {
    console.error('audit_log insert failed:', (e as Error).message)
  }
}

export function newebpayConfig(): NewebpayConfig | null {
  if (newebpayTestModeBlocked()) {
    void alertTestModeBlocked('config')
    return null
  }
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

export const supabaseStore: PaymentStore = {
  async getOrder(id) {
    const { data, error } = await admin().from('orders').select('id,status,total,payment_method,stock_reduced,meta').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return (data as StoreOrder) || null
  },
  async apply(orderId, kind, tradeNo, info, notes) {
    const { data, error } = await admin().rpc('newebpay_apply', { p_order_id: orderId, p_kind: kind, p_trade_no: tradeNo, p_info: info, p_notes: notes })
    if (error) throw new Error(error.message)
    const r = data as ApplyResult
    if (r.stock_lines?.length) refresh()
    return r
  },
  addNote: note,
  audit: auditRow,
  async logNotification(row) {
    const { error } = await admin().from('payment_notifications').insert({ gateway: 'newebpay', ...row })
    if (error) console.error('payment_notifications insert failed:', error.message)
  },
}

/**
 * Record a newly issued MerchantOrderNo on the order (a retry after failure issues a new one).
 * Atomic (row lock in site_dayinup.newebpay_issue_order_no): concurrent pay-page loads never lose a number. Throws on failure
 * so the customer is never sent to NewebPay with a number the notify handler would reject.
 */
export async function issueMerchantOrderNo(orderId: number, merchantOrderNo: string, gatewayTitle: string, noteLabel: string) {
  const { data, error } = await admin().rpc('newebpay_issue_order_no', { p_order_id: orderId, p_merchant_order_no: merchantOrderNo })
  if (error || data !== true) throw new Error(`issue MerchantOrderNo failed: ${error?.message || 'order not found'}`)
  await note(orderId, `使用 ${noteLabel} 付款`)
  await auditRow('newebpay_redirect', orderId, null, { merchant_order_no: merchantOrderNo, gateway: gatewayTitle })
}

/**
 * Anti-hoarding guard for NewebPay checkouts (unpaid orders hold stock for HOLD_STOCK_MINUTES). Counted in the DB
 * (site_dayinup.checkout_guard, per-ip / per-email advisory locks):
 *  - at most 10 checkout attempts per IP and 6 per e-mail in 10 minutes
 *  - at most 5 unpaid (pending, within the hold window) NewebPay orders per IP and 3 per e-mail
 * Returns a customer-facing message when blocked, else null. Fails open on DB errors (never blocks a real customer).
 */
export const CHECKOUT_LIMITS = { windowMinutes: 10, maxAttemptsIp: 10, maxAttemptsEmail: 6, maxUnpaidIp: 5, maxUnpaidEmail: 3 }
export async function checkoutGuard(ip: string | null, email: string | null): Promise<string | null> {
  const L = CHECKOUT_LIMITS
  const { data, error } = await admin().rpc('checkout_guard', {
    p_ip: ip, p_email: email, p_window_minutes: L.windowMinutes, p_max_attempts_ip: L.maxAttemptsIp, p_max_attempts_email: L.maxAttemptsEmail,
    p_hold_minutes: HOLD_STOCK_MINUTES, p_max_unpaid_ip: L.maxUnpaidIp, p_max_unpaid_email: L.maxUnpaidEmail,
  })
  if (error) {
    console.error('checkout_guard failed:', error.message)
    return null
  }
  return guardMessage(data as string | null)
}

/**
 * WooCommerce wc_cancel_unpaid_orders(): pending NewebPay checkout orders not modified for hold_stock_minutes are cancelled,
 * releasing their stock hold. Single source of truth = SQL site_dayinup.expire_unpaid_holds() (also run every 5 minutes by
 * pg_cron job site_dayinup_expire_holds). Called before every stock check (add to cart, cart qty change, checkout).
 * Limited to ry_newebpay% orders so the manual 待付款 fallback orders keep their old behaviour. Never throws.
 */
export async function cancelUnpaidOrders(): Promise<number> {
  try {
    const { data, error } = await admin().rpc('expire_unpaid_holds', { p_hold_minutes: HOLD_STOCK_MINUTES })
    if (error) throw new Error(error.message)
    return Number(data) || 0
  } catch (e) {
    console.error('expire_unpaid_holds failed:', (e as Error).message)
    return 0
  }
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
