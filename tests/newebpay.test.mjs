// NewebPay core unit tests — run with `npm test` (node --test, TypeScript stripped natively).
// Vectors were computed independently with `openssl enc -aes-256-cbc -nopad` (32-byte padding added by hand)
// and `shasum -a 256`, using made-up TEST keys (not real merchant credentials).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aesEncrypt, aesDecrypt, tradeSha, configFromEnv, verifyInbound, processInbound, buildMpgForm, GATEWAYS,
  generateMerchantOrderNo, orderIdFromMerchantOrderNo, enabledGateways, guardMessage, clientIp,
} from '../src/lib/newebpay/core.ts'

const KEY = 'abcdefghijklmnopqrstuvwxyzABCDEF'
const IV = '0123456789abcdef'
const PLAIN = 'MerchantID=MS123456789&RespondType=JSON&TimeStamp=1700000000&Version=2.0&MerchantOrderNo=1000123TS50000007171&Amt=1200&ItemDesc=test'
const CT = 'e0687482d9ddf28a76b6394657079e86c0d4eba91e9ac8640845e84aca991950388c76769ebbc8d61ee76c4ac0e1cf2da8b96c338e69e121c11a1c27aa3727f0438c8e0cf60b85b0707d48908e045f7bb74fd38aa097b2a761e7c39a54f21623f0a7103381bc64f9c89d742085e03b00c06b163a5220c6ce41415f8ac395676c8efb245a17bcf09f084ba0f05195c87ecd707f2bc64ccd225f81e53e0e8c205f'
const SHA = 'A9AB21D26A70AF42010C2F43C2B0D7D90EEFB25EEC34C5B2136B60F6B015E177'
const CFG = { merchantId: 'MS123456789', hashKey: KEY, hashIV: IV, env: 'test' }

test('AES-256-CBC encrypt matches openssl vector', () => assert.equal(aesEncrypt(PLAIN, KEY, IV), CT))
test('AES-256-CBC decrypt matches openssl vector', () => assert.equal(aesDecrypt(CT, KEY, IV), PLAIN))
test('TradeSha matches shasum vector', () => assert.equal(tradeSha(CT, KEY, IV), SHA))
test('decrypt with wrong key throws', () => assert.throws(() => aesDecrypt(CT, 'X'.repeat(32), IV)))

test('config: missing / malformed env → null (gateway hidden)', () => {
  assert.equal(configFromEnv({}), null)
  assert.equal(configFromEnv({ NEWEBPAY_MERCHANT_ID: 'M', NEWEBPAY_HASH_KEY: KEY, NEWEBPAY_HASH_IV: IV }), null) // no ENV
  assert.equal(configFromEnv({ NEWEBPAY_MERCHANT_ID: 'M', NEWEBPAY_HASH_KEY: 'short', NEWEBPAY_HASH_IV: IV, NEWEBPAY_ENV: 'test' }), null)
  assert.deepEqual(enabledGateways(null), [])
  const c = configFromEnv({ NEWEBPAY_MERCHANT_ID: 'M', NEWEBPAY_HASH_KEY: KEY, NEWEBPAY_HASH_IV: IV, NEWEBPAY_ENV: 'production' })
  assert.equal(c.env, 'production')
  assert.deepEqual(enabledGateways(c).map((g) => [g.id, g.title]), [['ry_newebpay_credit', '藍新信用卡']])
})

test('MerchantOrderNo format (RY Tools) round-trips the order id', () => {
  const no = generateMerchantOrderNo(1000123, 1700000000000, 5)
  assert.equal(no, '1000123TS50000000071') // 1700000000 reversed
  assert.equal(orderIdFromMerchantOrderNo(no), 1000123)
  assert.equal(orderIdFromMerchantOrderNo('abc'), null)
})

test('MPG form: amount from order, signed, decryptable', () => {
  const f = buildMpgForm(CFG, GATEWAYS[0], { id: 1000123, total: '1200.00', email: 'a@example.com', itemNames: ['票券A'] }, '1000123TS50000007171',
    { notifyUrl: 'https://x/n', returnUrl: 'https://x/r', customerUrl: 'https://x/c', clientBackUrl: 'https://x/b' }, 1700000000000)
  assert.equal(f.action, 'https://ccore.newebpay.com/MPG/mpg_gateway')
  assert.equal(f.fields.TradeSha, tradeSha(f.fields.TradeInfo, KEY, IV))
  const q = new URLSearchParams(aesDecrypt(f.fields.TradeInfo, KEY, IV))
  assert.equal(q.get('Amt'), '1200')
  assert.equal(q.get('CREDIT'), '1')
  assert.equal(q.get('NotifyURL'), 'https://x/n')
  assert.throws(() => buildMpgForm(CFG, GATEWAYS[0], { id: 1, total: 0, itemNames: [] }, '1TS1', { notifyUrl: '', returnUrl: '', customerUrl: '', clientBackUrl: '' }))
})

// ---------------------------------------------------------------- notify state machine (in-memory store)

function notifyBody(result, status = 'SUCCESS', message = '授權成功', cfg = CFG) {
  const TradeInfo = aesEncrypt(JSON.stringify({ Status: status, Message: message, Result: result }), cfg.hashKey, cfg.hashIV)
  return { Status: status, MerchantID: cfg.merchantId, Version: '2.0', TradeInfo, TradeSha: tradeSha(TradeInfo, cfg.hashKey, cfg.hashIV) }
}
const MON = '1000123TS50000007171'
const okResult = (over = {}) => ({ MerchantID: 'MS123456789', Amt: 1200, TradeNo: '23110112345678', MerchantOrderNo: MON, PaymentType: 'CREDIT', PayTime: '2023-11-01 12:00:00', Card6No: '400022', Card4No: '1111', Auth: '123456', ...over })

const ZH = { pending: '等待付款中', processing: '處理中', 'on-hold': '保留', cancelled: '已取消', failed: '失敗' }
const FROM = { paid: ['pending', 'failed', 'cancelled', 'on-hold'], 'on-hold': ['pending', 'failed'], failed: ['pending'] }
const TO = { paid: 'processing', 'on-hold': 'on-hold', failed: 'failed' }

// In-memory model of site_dayinup.newebpay_apply: all-or-nothing (snapshot + rollback on error), serialised like a row lock.
// `failNext` injects one DB error after the status/meta/notes writes but before the stock step (simulates a mid-way failure).
function makeStore(status = 'pending', total = '1200.00') {
  let lock = Promise.resolve()
  const s = {
    order: { id: 1000123, status, total, payment_method: 'ry_newebpay_credit', stock_reduced: false, meta: { newebpay: { merchant_order_nos: [MON] } }, transaction_id: null },
    stock: 10, notes: [], audits: [], logs: [], failNext: false,
    async getOrder(id) { return id === s.order.id ? structuredClone(s.order) : null },
    async apply(id, kind, tradeNo, info, notes) {
      const run = async () => {
        await new Promise((r) => setTimeout(r, 1))
        const snap = structuredClone({ order: s.order, stock: s.stock, notes: s.notes })
        try {
          const o = s.order
          const same = !!tradeNo && o.meta.newebpay?.trade_no === tradeNo
          const prev = o.status
          let reduce
          if (!FROM[kind].includes(o.status)) {
            reduce = kind !== 'failed' && same && o.status === TO[kind] && !o.stock_reduced
            if (!reduce) return { result: same ? 'same' : 'other', prev_status: prev, status: prev, stock_lines: [] }
          } else {
            o.status = TO[kind]
            if (kind === 'paid') o.transaction_id = tradeNo
            o.meta = { ...o.meta, newebpay: { ...o.meta.newebpay, ...info } }
            for (const n of notes) s.notes.push(n.replace('{from}', ZH[prev] || prev))
            reduce = kind !== 'failed' && !o.stock_reduced
          }
          if (s.failNext) { s.failNext = false; throw new Error('simulated DB error') }
          const lines = []
          if (reduce) {
            const old = s.stock; s.stock -= 2; o.stock_reduced = true
            lines.push(`票券A (#1) ${old}→${s.stock}`)
            s.notes.push(`庫存量已減少： ${lines.join(', ')}`)
          }
          return { result: FROM[kind].includes(prev) ? 'applied' : 'completed', prev_status: prev, status: TO[kind], stock_lines: lines }
        } catch (e) {
          Object.assign(s, snap)
          throw e
        }
      }
      const p = lock.then(run)
      lock = p.catch(() => {})
      return p
    },
    async addNote(id, n) { s.notes.push(n) },
    async audit(a, id, b, af) { s.audits.push(a) },
    async logNotification(r) { s.logs.push(r.outcome) },
  }
  return s
}

test('valid notify → processing, transaction id, stock reduced once, notes + audit', async () => {
  const s = makeStore()
  const r = await processInbound(s, CFG, notifyBody(okResult()))
  assert.deepEqual(r, { http: 200, outcome: 'paid' })
  assert.equal(s.order.status, 'processing')
  assert.equal(s.order.transaction_id, '23110112345678')
  assert.equal(s.stock, 8)
  assert.ok(s.notes.includes('付款完成'))
  assert.ok(s.audits.includes('newebpay_paid'))
  assert.equal(s.order.meta.newebpay.card4, '1111')
})

test('idempotent: same notify resent 3x → processed once, stock reduced once', async () => {
  const s = makeStore()
  const body = notifyBody(okResult())
  const outs = []
  for (let i = 0; i < 3; i++) outs.push((await processInbound(s, CFG, body)).outcome)
  assert.deepEqual(outs, ['paid', 'duplicate', 'duplicate'])
  assert.equal(s.stock, 8)
  assert.equal(s.notes.filter((n) => n === '付款完成').length, 1)
})

test('idempotent under concurrency: parallel notifies → one winner', async () => {
  const s = makeStore()
  const body = notifyBody(okResult())
  const outs = await Promise.all([1, 2, 3, 4].map(() => processInbound(s, CFG, body)))
  assert.equal(outs.filter((o) => o.outcome === 'paid').length, 1)
  assert.equal(s.stock, 8)
})

test('bad TradeSha → 400, order untouched', async () => {
  const s = makeStore()
  const body = notifyBody(okResult())
  body.TradeSha = 'A'.repeat(64)
  assert.deepEqual(await processInbound(s, CFG, body), { http: 400, outcome: 'bad_signature' })
  assert.equal(s.order.status, 'pending')
  assert.equal(s.stock, 10)
})

test('tampered TradeInfo (sha recomputed with another key) → 400', async () => {
  const s = makeStore()
  const forged = notifyBody(okResult(), 'SUCCESS', 'ok', { ...CFG, hashKey: 'Z'.repeat(32) })
  assert.equal((await processInbound(s, CFG, forged)).http, 400)
  assert.equal(s.order.status, 'pending')
})

test('amount mismatch → 400, order untouched, note written', async () => {
  const s = makeStore()
  const r = await processInbound(s, CFG, notifyBody(okResult({ Amt: 1 })))
  assert.deepEqual(r, { http: 400, outcome: 'amount_mismatch' })
  assert.equal(s.order.status, 'pending')
  assert.equal(s.stock, 10)
  assert.match(s.notes[0], /金額不符/)
})

test('MerchantID mismatch → 400', async () => {
  const s = makeStore()
  assert.equal((await processInbound(s, CFG, notifyBody(okResult({ MerchantID: 'OTHER' })))).http, 400)
  assert.equal(s.order.status, 'pending')
})

test('MerchantOrderNo never issued for this order → 400', async () => {
  const s = makeStore()
  const r = await processInbound(s, CFG, notifyBody(okResult({ MerchantOrderNo: '1000123TS99999999999' })))
  assert.deepEqual(r, { http: 400, outcome: 'order_no_mismatch' })
  assert.equal(s.order.status, 'pending')
})

test('failure notify: pending → failed (WooCommerce note), resend is a no-op', async () => {
  const s = makeStore()
  const body = notifyBody(okResult(), 'MPG03009', '授權失敗')
  assert.equal((await processInbound(s, CFG, body)).outcome, 'failed')
  assert.equal(s.order.status, 'failed')
  assert.equal(s.notes[0], '付款失敗： 授權失敗 (MPG03009) 訂單狀態由 等待付款中 變更為 失敗.')
  assert.equal((await processInbound(s, CFG, body)).outcome, 'ignored')
  assert.equal(s.notes.length, 1)
  assert.equal(s.stock, 10)
})

test('failed then paid (retry) → processing; late failure for paid order ignored', async () => {
  const s = makeStore('failed')
  assert.equal((await processInbound(s, CFG, notifyBody(okResult()))).outcome, 'paid')
  assert.equal(s.order.status, 'processing')
  assert.equal((await processInbound(s, CFG, notifyBody(okResult(), 'MPG03009', 'x'))).outcome, 'ignored')
  assert.equal(s.order.status, 'processing')
})

test('cancelled (unpaid timeout) then paid → processing (WooCommerce payment_complete allows cancelled)', async () => {
  const s = makeStore('cancelled')
  assert.equal((await processInbound(s, CFG, notifyBody(okResult()))).outcome, 'paid')
  assert.equal(s.order.status, 'processing')
})

test('second, different successful trade on a paid order → duplicate + manual-refund note, no stock change', async () => {
  const s = makeStore()
  await processInbound(s, CFG, notifyBody(okResult()))
  const r = await processInbound(s, CFG, notifyBody(okResult({ TradeNo: 'OTHER-TRADE' })))
  assert.equal(r.outcome, 'duplicate')
  assert.equal(s.stock, 8)
  assert.match(s.notes.at(-1), /人工確認/)
})

test('verifyInbound rejects missing fields', () => {
  assert.deepEqual(verifyInbound(CFG, {}), { ok: false, error: 'missing' })
})

// ---------------------------------------------------------------- security review follow-ups

test('mid-way DB failure → notify throws (route answers 500), nothing half-written; NewebPay resend completes it once', async () => {
  const s = makeStore()
  const body = notifyBody(okResult())
  s.failNext = true
  await assert.rejects(processInbound(s, CFG, body), /simulated DB error/)
  assert.equal(s.order.status, 'pending') // rolled back: no "paid but stock never reduced" state
  assert.equal(s.order.transaction_id, null)
  assert.equal(s.stock, 10)
  assert.deepEqual(s.notes, [])
  const r = await processInbound(s, CFG, body) // NewebPay retries after the 500
  assert.deepEqual(r, { http: 200, outcome: 'paid' })
  assert.equal(s.order.status, 'processing')
  assert.equal(s.stock, 8)
  assert.equal(s.notes.filter((n) => n === '付款完成').length, 1)
  assert.ok(!s.notes.some((n) => /人工確認/.test(n)), 'no false "possible double payment" note')
  assert.equal((await processInbound(s, CFG, body)).outcome, 'duplicate')
  assert.equal(s.stock, 8)
})

test('legacy partial state (processing, same trade, stock not reduced) → resend finishes the stock step, no refund note', async () => {
  const s = makeStore('processing')
  s.order.meta.newebpay.trade_no = '23110112345678'
  const r = await processInbound(s, CFG, notifyBody(okResult()))
  assert.equal(r.outcome, 'paid')
  assert.equal(s.stock, 8)
  assert.ok(s.audits.includes('newebpay_paid_completed'))
  assert.ok(!s.notes.some((n) => /人工確認/.test(n)))
})

test('status note uses the status that was actually changed (failed → processing)', async () => {
  const s = makeStore('failed')
  await processInbound(s, CFG, notifyBody(okResult()))
  assert.ok(s.notes.includes('訂單狀態由 失敗 變更為 處理中.'))
})

test('ATM/CVS 取號 (customer) → on-hold with instructions + stock once; resend duplicate', async () => {
  const s = makeStore()
  const body = notifyBody(okResult({ PaymentType: 'CVS', CodeNo: 'LLL12345678', ExpireDate: '2026-11-01' }))
  assert.equal((await processInbound(s, CFG, body, 'customer')).outcome, 'on-hold')
  assert.equal(s.order.status, 'on-hold')
  assert.match(s.notes[0], /超商代碼：LLL12345678.*等待付款中 變更為 保留/)
  assert.equal(s.stock, 8)
  assert.equal((await processInbound(s, CFG, body, 'customer')).outcome, 'duplicate')
  // later paid notify: on-hold → processing, stock not reduced again
  assert.equal((await processInbound(s, CFG, notifyBody(okResult()))).outcome, 'paid')
  assert.equal(s.stock, 8)
})

test('checkout guard messages + client IP extraction', () => {
  assert.equal(guardMessage(null), null)
  assert.match(guardMessage('unpaid_email'), /尚未付款的訂單/)
  assert.match(guardMessage('unpaid_ip'), /60 分鐘/)
  assert.match(guardMessage('rate_ip'), /過於頻繁/)
  const h = (o) => ({ get: (k) => o[k] ?? null })
  assert.equal(clientIp(h({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' })), '1.2.3.4')
  assert.equal(clientIp(h({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' })), '5.6.7.8')
  assert.equal(clientIp(h({})), null)
})
