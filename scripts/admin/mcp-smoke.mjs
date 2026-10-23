// MCP smoke test with the official SDK client.
// usage: MCP_URL=http://localhost:3311/api/mcp MCP_TOKEN=... node scripts/admin/mcp-smoke.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const url = process.env.MCP_URL || 'http://localhost:3000/api/mcp'
const token = process.env.MCP_TOKEN
if (!token) throw new Error('MCP_TOKEN missing')
const client = new Client({ name: 'dayinup-smoke', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content?.[0]?.text || ''
  if (r.isError) throw new Error(`${name}: ${text}`)
  return JSON.parse(text)
}
const short = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]))

const tools = await client.listTools()
console.log(`tools/list -> ${tools.tools.length} tools:`, tools.tools.map((t) => t.name).join(', '))

const list = await call('list_posts', { post_type: 'post', status: 'publish', limit: 1 })
console.log(`list_posts(post,publish) -> total ${list.total}; first:`, short(list.rows[0], ['id', 'title', 'path']))
const post = await call('get_post', { id: list.rows[0].id })
console.log('get_post ->', { ...short(post, ['id', 'post_type', 'status', 'path']), content_html_chars: post.content_html.length, terms: post.terms.map((t) => t.name) })

const stamp = new Date().toISOString()
const draft = await call('create_post', { post_type: 'post', title: `MCP 測試草稿 ${stamp}`, content_html: '<p>由 MCP 建立的草稿。</p>' })
console.log('create_post ->', short(draft, ['id', 'status', 'slug', 'path', 'title']))
const upd = await call('update_post', { id: draft.id, title: `MCP 測試草稿（已修改）${stamp}`, content_html: '<p>已由 MCP 修改。</p>' })
console.log('update_post ->', short(upd, ['id', 'status', 'title', 'content_html']))
const trash = await call('delete_post', { id: draft.id })
console.log('delete_post ->', trash)
const del = await call('delete_post', { id: draft.id, force: true })
console.log('delete_post(force) ->', del)
const gone = await client.callTool({ name: 'get_post', arguments: { id: draft.id } })
console.log('get_post after delete ->', gone.isError ? gone.content[0].text : 'STILL EXISTS')
const audit = await call('get_audit_log', { entity_type: 'posts', entity_id: String(draft.id), limit: 10 })
console.log('audit_log for draft ->', audit.map((a) => `${a.via}:${a.action}`).join(', '))
await client.close()
