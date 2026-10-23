// MCP shop smoke test: draft variable product + 票種 variations + price/stock/terms + discount rule + order status.
// usage: MCP_URL=... MCP_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/admin/mcp-shop-smoke.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const c = new Client({ name: 'dayinup-shop-smoke', version: '1.0.0' })
await c.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_URL), { requestInit: { headers: { Authorization: `Bearer ${process.env.MCP_TOKEN}` } } }))
const call = async (name, args) => {
  const r = await c.callTool({ name, arguments: args })
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`)
  return JSON.parse(r.content[0].text)
}
const pick = (o, k) => Object.fromEntries(k.map((x) => [x, o[x]]))
const p = await call('create_product', { name: 'MCP 測試活動 09/30（草稿）', type: 'variable', short_description_html: '<p>測試</p>' })
console.log('create_product ->', pick(p, ['id', 'status', 'slug', 'path', 'type']))
const vs = []
for (const [label, reg, sale] of [['🎫 1人出行', 500, null], ['🎫 早鳥票（9折）', 500, 450], ['🎫 2人同行 （95折）', 1000, 950]]) {
  vs.push(await call('create_record', { entity: 'product_variations', data: { product_id: p.id, attributes: { 票種: label }, regular_price: reg, sale_price: sale, status: 'publish' } }))
}
console.log('variations ->', vs.map((v) => pick(v, ['id', 'label', 'price', 'on_sale'])))
let full = await call('get_product', { id: p.id })
console.log('synced product price ->', pick(full, ['price', 'price_min', 'price_max', 'on_sale']))
await call('set_product_price', { product_id: p.id, variation_id: vs[0].id, regular_price: 400 })
await call('adjust_stock', { product_id: p.id, variation_id: vs[1].id, set: 0 })
full = await call('get_product', { id: p.id })
console.log('after set_price/adjust_stock ->', pick(full, ['price_min', 'price_max']), full.variations.map((v) => pick(v, ['id', 'price', 'stock_quantity', 'stock_status'])))
const cats = await call('list_terms', { taxonomy: 'product_cat', search: 'Talk2Talk' })
await call('set_object_terms', { kind: 'product', id: p.id, term_ids: [cats.rows[0].id] })
full = await call('get_product', { id: p.id })
console.log('terms ->', full.terms.map((t) => t.name))
const rule = await call('create_record', { entity: 'discount_rules', data: { label: '2人同行 95 折', product_id: p.id, variation_id: vs[2].id, persons: 2, discount_type: 'percent', discount_value: 5 } })
console.log('discount rule ->', pick(rule, ['id', 'label', 'persons', 'discount_type', 'discount_value', 'active']))
// order status (test order inserted directly; real orders arrive from checkout as pending)
const H = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Profile': 'site_dayinup', 'Content-Type': 'application/json', Prefer: 'return=representation' }
const o = (await (await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'pending', billing_email: 'mcp-test@example.com', billing: { first_name: '測試', email: 'mcp-test@example.com' }, total: 950, subtotal: 950, payment_method: 'bacs', meta: { test: true } }) })).json())[0]
const orders = await call('list_orders', { status: 'pending', search: 'mcp-test@example.com' })
console.log('list_orders(pending) ->', orders.total, orders.rows.map((r) => pick(r, ['id', 'status', 'total'])))
await call('update_order_status', { id: o.id, status: 'processing', note: '已確認匯款（MCP 測試）' })
const og = await call('get_order', { id: o.id })
console.log('get_order after status ->', pick(og, ['id', 'status', 'date_paid']), og.notes.map((n) => n.note))
await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?id=eq.${o.id}`, { method: 'DELETE', headers: H })
// cleanup
await call('delete_product', { id: p.id, force: true })
const after = await c.callTool({ name: 'get_product', arguments: { id: p.id } })
console.log('cleanup ->', after.content[0].text, '| rule gone:', (await call('list_records', { entity: 'discount_rules', filters: { product_id: p.id } })).total === 0)
const audit = await call('get_audit_log', { entity_type: 'products', entity_id: String(p.id), limit: 20 })
console.log('audit(products) ->', audit.map((a) => `${a.via}:${a.action}`).join(', '))
await c.close()
