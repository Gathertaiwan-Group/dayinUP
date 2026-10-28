/**
 * NewebPay (藍新金流) MPG — pure core: crypto, config parsing, and the notify state machine.
 *
 * No Next.js / Supabase imports on purpose: this file is unit-tested directly with `node --test`
 * (tests/newebpay.test.mjs) against an in-memory store. The Supabase store lives in ./service.ts.
 *
 * Behaviour mirrors the old WooCommerce site (RY WooCommerce Tools, gateway `ry_newebpay_credit`):
 *  - paid      → payment_complete(): pending/failed/cancelled/on-hold → processing, note 付款完成, reduce stock once
 *  - failed    → only a pending order becomes failed, note 付款失敗：<Message> (<Status>)
 *  - unpaid    → pending checkout orders are cancelled after woocommerce_hold_stock_minutes (60)
 */
import crypto from 'node:crypto'

// ------------------------------------------------------------------ config

export type NewebpayEnv = 'test' | 'production'
export type NewebpayConfig = { merchantId: string; hashKey: string; hashIV: string; env: NewebpayEnv }

export const GATEWAY_URL: Record<NewebpayEnv, string> = {
  test: 'https://ccore.newebpay.com/MPG/mpg_gateway',
  production: 'https://core.newebpay.com/MPG/mpg_gateway',
}

/** null = not configured → the gateway is hidden and checkout keeps the plain 待付款 behaviour. */
export function configFromEnv(env: Record<string, string | undefined>): NewebpayConfig | null {
  const merchantId = (env.NEWEBPAY_MERCHANT_ID || '').trim()
  const hashKey = (env.NEWEBPAY_HASH_KEY || '').trim()
  const hashIV = (env.NEWEBPAY_HASH_IV || '').trim()
  const e = (env.NEWEBPAY_ENV || '').trim().toLowerCase()
  if (!merchantId || hashKey.length !== 32 || hashIV.length !== 16) return null
  if (e !== 'test' && e !== 'production') return null
  return { merchantId, hashKey, hashIV, env: e }
}

// ------------------------------------------------------------------ payment methods (old site: only 藍新信用卡 enabled)

export type GatewayId = 'ry_newebpay_credit' | 'ry_newebpay_atm' | 'ry_newebpay_cvs'
export type GatewayDef = { id: GatewayId; title: string; description: string; enabled: boolean; mpgFlag: 'CREDIT' | 'VACC' | 'CVS'; noteLabel: string }

/**
 * From the old wp_options: woocommerce_ry_newebpay_credit_settings (enabled=yes, title 藍新信用卡, description 使用信用卡付款).
 * ATM / 超商代碼 gateways exist in RY Tools but were never configured (no settings row → disabled), so they stay off.
 */
export const GATEWAYS: GatewayDef[] = [
  { id: 'ry_newebpay_credit', title: '藍新信用卡', description: '使用信用卡付款', enabled: true, mpgFlag: 'CREDIT', noteLabel: '藍新金流信用卡' },
  { id: 'ry_newebpay_atm', title: '藍新ATM轉帳', description: '使用 ATM 轉帳付款', enabled: false, mpgFlag: 'VACC', noteLabel: '藍新金流ATM轉帳' },
  { id: 'ry_newebpay_cvs', title: '藍新超商代碼', description: '使用超商代碼付款', enabled: false, mpgFlag: 'CVS', noteLabel: '藍新金流超商代碼' },
]

export function enabledGateways(cfg: NewebpayConfig | null): GatewayDef[] {
  return cfg ? GATEWAYS.filter((g) => g.enabled) : []
}
export function gatewayById(id: string | null | undefined): GatewayDef | undefined {
  return GATEWAYS.find((g) => g.id === id)
}

/** woocommerce_hold_stock_minutes on the old site */
export const HOLD_STOCK_MINUTES = 60
/** WooCommerce: statuses from which payment_complete() may move an order to processing (enforced in SQL site_dayinup.newebpay_apply) */
export const PAYABLE_FROM = ['pending', 'failed', 'cancelled', 'on-hold']
/** WooCommerce needs_payment(): the customer may (re)start payment for these */
export const NEEDS_PAYMENT = ['pending', 'failed']

export const WC_STATUS_ZH: Record<string, string> = {
  pending: '等待付款中', processing: '處理中', 'on-hold': '保留', completed: '完成', cancelled: '已取消', refunded: '已退費', failed: '失敗',
}

/** Customer-facing text for a checkout_guard() verdict (null = allowed). */
export function guardMessage(code: string | null | undefined): string | null {
  if (!code) return null
  if (code === 'unpaid_ip' || code === 'unpaid_email')
    return `您已有尚未付款的訂單，請先至「我的帳戶 → 訂單」完成付款，或等待 ${HOLD_STOCK_MINUTES} 分鐘未付款訂單自動取消後再下單。`
  return '結帳次數過於頻繁，請稍候 10 分鐘再試。'
}

/** Client IP as set by the platform proxy (Vercel overwrites x-real-ip / x-forwarded-for; clients cannot spoof them). */
export function clientIp(headers: { get(name: string): string | null }): string | null {
  const ip = (headers.get('x-real-ip') || (headers.get('x-forwarded-for') || '').split(',')[0] || '').trim()
  return ip ? ip.slice(0, 64) : null
}

// ------------------------------------------------------------------ crypto (NewebPay MPG: AES-256-CBC hex, 32-byte PKCS#7-style padding; SHA256)

function pad32(buf: Buffer): Buffer {
  const n = 32 - (buf.length % 32)
  return Buffer.concat([buf, Buffer.alloc(n, n)])
}

export function aesEncrypt(plain: string, key: string, iv: string): string {
  const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'))
  c.setAutoPadding(false)
  return Buffer.concat([c.update(pad32(Buffer.from(plain, 'utf8'))), c.final()]).toString('hex')
}

/** Throws on malformed hex / wrong key (bad padding). */
export function aesDecrypt(hex: string, key: string, iv: string): string {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 32 !== 0) throw new Error('bad ciphertext')
  const d = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'))
  d.setAutoPadding(false)
  const out = Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()])
  const n = out[out.length - 1]
  if (!n || n > 32 || n > out.length) throw new Error('bad padding')
  for (let i = out.length - n; i < out.length; i++) if (out[i] !== n) throw new Error('bad padding')
  return out.subarray(0, out.length - n).toString('utf8')
}

export function tradeSha(tradeInfo: string, key: string, iv: string): string {
  return crypto.createHash('sha256').update(`HashKey=${key}&${tradeInfo}&HashIV=${iv}`).digest('hex').toUpperCase()
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a.toUpperCase())
  const y = Buffer.from(b.toUpperCase())
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** PHP http_build_query equivalent for the flat MPG parameter set */
export function buildQuery(params: Record<string, string | number>): string {
  return new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
}

// ------------------------------------------------------------------ MPG request

/**
 * RY Tools format: <order id>TS<rand><reversed unix time>, max 30 chars (A-Z a-z 0-9 _). RY uses one random digit; we use
 * 0–999 so two pay-page loads in the same second (two tabs) practically never get the same number (NewebPay rejects repeats).
 */
export function generateMerchantOrderNo(orderId: number, nowMs = Date.now(), rand = crypto.randomInt(0, 1000)): string {
  return `${orderId}TS${rand}${String(Math.floor(nowMs / 1000)).split('').reverse().join('')}`.slice(0, 30)
}
export function orderIdFromMerchantOrderNo(no: string): number | null {
  const m = /^(\d+)TS\d+$/.exec(no || '')
  return m ? Number(m[1]) : null
}

/** Truncate by characters (ItemDesc max 50). */
function cut(s: string, n: number): string {
  return Array.from(s).slice(0, n).join('')
}

export type MpgOrder = { id: number; total: number | string; email?: string | null; itemNames: string[] }
export type MpgUrls = { notifyUrl: string; returnUrl: string; customerUrl: string; clientBackUrl: string }

export function orderAmount(total: number | string): number {
  return Math.round(Number(total))
}

export function buildMpgForm(cfg: NewebpayConfig, gw: GatewayDef, order: MpgOrder, merchantOrderNo: string, urls: MpgUrls, nowMs = Date.now()) {
  const amt = orderAmount(order.total)
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('invalid amount')
  const params: Record<string, string | number> = {
    MerchantID: cfg.merchantId,
    RespondType: 'JSON',
    TimeStamp: Math.floor(nowMs / 1000),
    Version: '2.0',
    LangType: 'zh-tw',
    MerchantOrderNo: merchantOrderNo,
    Amt: amt,
    ItemDesc: cut(order.itemNames.join(',').replace(/[\r\n]+/g, ' ') || `訂單 ${order.id}`, 50),
    ReturnURL: urls.returnUrl,
    NotifyURL: urls.notifyUrl,
    ClientBackURL: urls.clientBackUrl,
    Email: order.email || '',
    EmailModify: 0,
    LoginType: 0,
    [gw.mpgFlag]: 1,
  }
  if (gw.mpgFlag !== 'CREDIT') {
    params.CustomerURL = urls.customerUrl
    params.ExpireDate = expireDate(nowMs, 3)
  }
  const TradeInfo = aesEncrypt(buildQuery(params), cfg.hashKey, cfg.hashIV)
  return {
    action: GATEWAY_URL[cfg.env],
    fields: { MerchantID: cfg.merchantId, TradeInfo, TradeSha: tradeSha(TradeInfo, cfg.hashKey, cfg.hashIV), Version: '2.0' },
  }
}

function expireDate(nowMs: number, days: number): string {
  const d = new Date(nowMs + 8 * 3600_000 + days * 86400_000) // Asia/Taipei
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

// ------------------------------------------------------------------ inbound (Notify / Return / Customer)

export type Decoded = { Status: string; Message: string; Result: Record<string, any> }
export type VerifyResult = { ok: true; data: Decoded } | { ok: false; error: 'missing' | 'bad_sha' | 'decrypt_failed' | 'merchant_mismatch' }

/** Verifies TradeSha, decrypts TradeInfo and checks MerchantID. Never trusts the plaintext `Status` form field. */
export function verifyInbound(cfg: NewebpayConfig, body: Record<string, string | undefined>): VerifyResult {
  const ti = body.TradeInfo || ''
  const sha = body.TradeSha || ''
  if (!ti || !sha) return { ok: false, error: 'missing' }
  if (!safeEqual(tradeSha(ti, cfg.hashKey, cfg.hashIV), sha)) return { ok: false, error: 'bad_sha' }
  let data: Decoded
  try {
    const plain = aesDecrypt(ti, cfg.hashKey, cfg.hashIV)
    const j = JSON.parse(plain)
    data = { Status: String(j.Status || ''), Message: String(j.Message || ''), Result: typeof j.Result === 'string' ? JSON.parse(j.Result) : j.Result || {} }
  } catch {
    return { ok: false, error: 'decrypt_failed' }
  }
  if (String(data.Result.MerchantID || '') !== cfg.merchantId) return { ok: false, error: 'merchant_mismatch' }
  return { ok: true, data }
}

/** Payment info worth keeping on the order (admin page). Card numbers are already masked by NewebPay (6+4). */
export function paymentInfo(r: Record<string, any>) {
  const pick = (k: string) => (r[k] === undefined || r[k] === null || r[k] === '' ? undefined : String(r[k]))
  const info: Record<string, string | undefined> = {
    trade_no: pick('TradeNo'),
    merchant_order_no: pick('MerchantOrderNo'),
    payment_type: pick('PaymentType'),
    amt: pick('Amt'),
    pay_time: pick('PayTime'),
    auth_bank: pick('AuthBank'),
    card6: pick('Card6No'),
    card4: pick('Card4No'),
    auth_code: pick('Auth'),
    inst: pick('Inst'),
    bank_code: pick('BankCode'), // ATM 取號: 收款銀行代碼
    account: pick('PaymentType') === 'VACC' ? pick('CodeNo') : undefined, // ATM 取號: 轉帳帳號
    payer_bank_code: pick('PayBankCode'), // ATM 付款完成: 付款人銀行
    payer_account5: pick('PayerAccount5Code'),
    code_no: pick('PaymentType') === 'CVS' ? pick('CodeNo') : undefined,
    store_type: pick('StoreType'),
    expire_date: pick('ExpireDate'),
    expire_time: pick('ExpireTime'),
  }
  return Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined)) as Record<string, string>
}

// ------------------------------------------------------------------ state machine over an abstract store

export type StoreOrder = { id: number; status: string; total: number | string; payment_method: string | null; stock_reduced: boolean; meta: Record<string, any> }

export type ApplyKind = 'paid' | 'on-hold' | 'failed'
export type ApplyResult = {
  /** applied = status changed now; completed = same trade, only the missing stock step was finished; same / other = already handled */
  result: 'applied' | 'completed' | 'same' | 'other' | 'not_found'
  prev_status?: string
  status?: string
  stock_lines?: string[]
}

export interface PaymentStore {
  getOrder(id: number): Promise<StoreOrder | null>
  /**
   * ONE transaction under a row lock (site_dayinup.newebpay_apply): status compare-and-set + trade data (meta, transaction_id,
   * date_paid) + notes + stock reduction (once, guarded by stock_reduced). Throws on DB error with nothing written.
   * `{from}` in notes is replaced with the zh label of the status that was actually changed.
   */
  apply(orderId: number, kind: ApplyKind, tradeNo: string | null, info: Record<string, unknown>, notes: string[]): Promise<ApplyResult>
  addNote(orderId: number, note: string): Promise<void>
  audit(action: string, orderId: number | null, before: unknown, after: unknown): Promise<void>
  logNotification(row: { order_id: number | null; kind: string; merchant_order_no: string | null; trade_no: string | null; status: string | null; amount: number | null; outcome: string; result: unknown }): Promise<void>
}

export type InboundKind = 'notify' | 'customer'
export type Outcome =
  | { http: 200; outcome: 'paid' | 'failed' | 'on-hold' | 'duplicate' | 'ignored' }
  | { http: 400; outcome: 'bad_signature' | 'unknown_order' | 'amount_mismatch' | 'order_no_mismatch' }

export async function processInbound(store: PaymentStore, cfg: NewebpayConfig, body: Record<string, string | undefined>, kind: InboundKind = 'notify'): Promise<Outcome> {
  const v = verifyInbound(cfg, body)
  if (!v.ok) {
    await store.audit(`newebpay_${kind}_rejected`, null, null, { error: v.error })
    return { http: 400, outcome: 'bad_signature' }
  }
  const { Status, Message, Result } = v.data
  const mon = String(Result.MerchantOrderNo || '')
  const amt = Number(Result.Amt)
  const tradeNo = Result.TradeNo ? String(Result.TradeNo) : null
  const orderId = orderIdFromMerchantOrderNo(mon)
  const log = (order_id: number | null, outcome: string) =>
    store.logNotification({ order_id, kind, merchant_order_no: mon || null, trade_no: tradeNo, status: Status, amount: Number.isFinite(amt) ? amt : null, outcome, result: v.data })

  const order = orderId ? await store.getOrder(orderId) : null
  if (!order || !String(order.payment_method || '').startsWith('ry_newebpay')) {
    await log(order?.id ?? null, 'unknown_order')
    await store.audit(`newebpay_${kind}_rejected`, orderId, null, { error: 'unknown_order', merchant_order_no: mon })
    return { http: 400, outcome: 'unknown_order' }
  }
  const issued: string[] = order.meta?.newebpay?.merchant_order_nos || []
  if (!issued.includes(mon)) {
    await log(order.id, 'order_no_mismatch')
    await store.audit(`newebpay_${kind}_rejected`, order.id, null, { error: 'order_no_mismatch', merchant_order_no: mon })
    return { http: 400, outcome: 'order_no_mismatch' }
  }
  if (!Number.isFinite(amt) || amt !== orderAmount(order.total)) {
    await log(order.id, 'amount_mismatch')
    await store.addNote(order.id, `藍新金流通知金額不符（通知 ${Result.Amt}，訂單 ${orderAmount(order.total)}），未變更訂單狀態。交易序號：${tradeNo || '—'}`)
    await store.audit(`newebpay_${kind}_rejected`, order.id, null, { error: 'amount_mismatch', amt: Result.Amt, total: order.total, trade_no: tradeNo })
    return { http: 400, outcome: 'amount_mismatch' }
  }

  const info: Record<string, string> = { ...paymentInfo(Result), status: Status, message: Message }

  if (Status === 'SUCCESS' && kind === 'notify') {
    const r = await store.apply(order.id, 'paid', tradeNo, info, ['付款完成', '訂單狀態由 {from} 變更為 處理中.'])
    if (r.result !== 'applied' && r.result !== 'completed') {
      // already paid (or refunded/completed): a resend of the same notify is a no-op; a *different* trade is a double charge
      await log(order.id, 'duplicate')
      if (r.result === 'other') {
        await store.addNote(order.id, `收到另一筆藍新付款成功通知（交易序號 ${tradeNo}），訂單已是「${WC_STATUS_ZH[r.prev_status || order.status] || r.prev_status || order.status}」，未重複處理，請人工確認是否需退款。`)
        await store.audit('newebpay_duplicate_payment', order.id, null, { trade_no: tradeNo, merchant_order_no: mon })
      }
      return { http: 200, outcome: 'duplicate' }
    }
    await store.audit(r.result === 'applied' ? 'newebpay_paid' : 'newebpay_paid_completed', order.id, { status: r.prev_status }, { status: 'processing', trade_no: tradeNo, payment_type: info.payment_type, amt, stock: r.stock_lines || [] })
    await log(order.id, 'paid')
    return { http: 200, outcome: 'paid' }
  }

  if (Status === 'SUCCESS' && kind === 'customer') {
    // ATM / 超商代碼 取號完成 (RY Tools: order on-hold with the payment instructions; WC reduces stock on on-hold)
    const detail = info.code_no ? `超商代碼：${info.code_no}` : `銀行代碼：${info.bank_code || '—'}，轉帳帳號：${info.account || '—'}`
    const r = await store.apply(order.id, 'on-hold', tradeNo, info, [
      `已取得付款資訊，${detail}，繳費期限：${[info.expire_date, info.expire_time].filter(Boolean).join(' ') || '—'}。訂單狀態由 {from} 變更為 保留.`,
    ])
    if (r.result !== 'applied') {
      await log(order.id, 'duplicate')
      return { http: 200, outcome: 'duplicate' }
    }
    await store.audit('newebpay_on_hold', order.id, { status: r.prev_status }, { ...info, status: 'on-hold' })
    await log(order.id, 'on-hold')
    return { http: 200, outcome: 'on-hold' }
  }

  // failure: WooCommerce only fails a still-pending order
  const r = await store.apply(order.id, 'failed', tradeNo, info, [`付款失敗： ${Message} (${Status}) 訂單狀態由 {from} 變更為 失敗.`])
  if (r.result !== 'applied') {
    await log(order.id, 'ignored')
    return { http: 200, outcome: 'ignored' }
  }
  await store.audit('newebpay_failed', order.id, { status: r.prev_status }, { status: 'failed', message: Message, code: Status })
  await log(order.id, 'failed')
  return { http: 200, outcome: 'failed' }
}
