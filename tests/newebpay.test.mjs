// NewebPay core unit tests — run with `npm test` (node --test, TypeScript stripped natively).
// Vectors were computed independently with `openssl enc -aes-256-cbc -nopad` (32-byte padding added by hand)
// and `shasum -a 256`, using made-up TEST keys (not real merchant credentials).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aesEncrypt, aesDecrypt, tradeSha, configFromEnv, verifyInbound, processInbound, buildMpgForm, GATEWAYS,
  generateMerchantOrderNo, orderIdFromMerchantOrderNo, enabledGateways,
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

function makeStore(status = 'pending', total = '1200.00') {
  const s = {
    order: { id: 1000123, status, total, payment_method: 'ry_newebpay_credit', stock_reduced: false, meta: { newebpay: { merchant_order_nos: [MON] } }, transaction_id: null },
    stock: 10, notes: [], audits: [], logs: [],
    async getOrder(id) { return id === s.order.id ? structuredClone(s.order) : null },
    async casStatus(id, from, to, patch) {
      if (id !== s.order.id || !from.includes(s.order.status)) return false
      Object.assign(s.order, patch, { status: to }); return true
    },
    async claimStockReduction(id) { if (s.order.stock_reduced) return false; s.order.stock_reduced = true; return true },
    async reduceStock() { const o = s.stock; s.stock -= 2; return [`票券A (#1) ${o}→${s.stock}`] },
    async mergeMeta(id, n) { s.order.meta = { ...s.order.meta, newebpay: { ...s.order.meta.newebpay, ...n } } },
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
