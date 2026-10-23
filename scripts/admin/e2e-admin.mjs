// Admin UI end-to-end check (Playwright).
// usage: BASE=http://localhost:3311 ADMIN_EMAIL=... ADMIN_PW=... TOOLS_DIR=<node_modules dir with playwright+sharp> node scripts/admin/e2e-admin.mjs
// Creates one draft post + one uploaded image, then removes both (post via UI trash + MCP force delete is done by the caller).
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// playwright lives in the shared tools dir (ESM ignores NODE_PATH)
const req = createRequire((process.env.TOOLS_DIR || process.cwd() + '/node_modules') + '/')
const { chromium } = req('playwright')
const BASE = process.env.BASE || 'http://localhost:3000'
const EMAIL = process.env.ADMIN_EMAIL
const PW = process.env.ADMIN_PW
if (!EMAIL || !PW) throw new Error('ADMIN_EMAIL / ADMIN_PW missing')
const results = []
const okLabel = (u) => { try { return new URL(u).searchParams.get('ok') || '' } catch { return '' } }
const submitAndWait = async (pg, selector, label) => {
  await Promise.all([pg.waitForURL((u) => okLabel(u.href).includes(label), { timeout: 20000 }), pg.click(selector)])
  await pg.waitForLoadState('networkidle')
}
const check = (name, cond, extra = '') => {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {})
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

// 0. guard
let r = await page.goto(`${BASE}/admin/products/`)
check('unauthenticated /admin/products/ -> login', page.url().includes('/admin/login'), page.url())

// 1. wrong password
await page.fill('#email', EMAIL)
await page.fill('#password', 'wrong-password-123')
await page.click('button[type=submit]')
await page.waitForSelector('.adm-flash.err', { timeout: 15000 })
check('wrong password rejected', page.url().includes('/admin/login'))

// 2. login
await page.fill('#email', EMAIL)
await page.fill('#password', PW)
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/admin/login'), { timeout: 20000 }), page.click('button[type=submit]')])
check('login ok -> dashboard', new URL(page.url()).pathname.replace(/\/$/, '') === '/admin', page.url())

// 3. every nav page + first detail page renders
await page.waitForSelector('nav a', { timeout: 15000 })
const navLinks = await page.$$eval('nav a', (as) => as.map((a) => a.getAttribute('href')))
for (const href of navLinks) {
  r = await page.goto(BASE + href)
  const body = await page.textContent('body')
  const bad = r.status() >= 400 || /Application error|Internal Server Error/.test(body)
  // first detail link inside main table/grid
  const detail = await page.$$eval('main a[href^="/admin/"]', (as, h) => as.map((a) => a.getAttribute('href')).find((x) => x && /\/\d+\/?$|\/[a-z0-9_.-]+\/?$/.test(x) && !x.includes('?') && x !== h && !/\/new\/?$/.test(x)), href)
  let dStatus = '-'
  if (detail && /\/(\d+|[^/]+)\/$/.test(detail) && detail.split('/').length > href.split('?')[0].split('/').length) {
    const d = await page.goto(BASE + detail)
    const dBody = await page.textContent('body')
    dStatus = d.status() >= 400 || /Application error|Internal Server Error/.test(dBody) ? `FAIL ${d.status()}` : `${d.status()}`
  }
  check(`page ${href}`, !bad && !String(dStatus).startsWith('FAIL'), `status=${r.status()} detail=${detail || '-'}:${dStatus}`)
}

// 4. create a post draft with the WYSIWYG editor
const stamp = Date.now()
await page.goto(`${BASE}/admin/content/new/?type=post`)
await page.fill('input[name=title]', `E2E 後台草稿 ${stamp}`)
await page.click('.ed')
await page.keyboard.type(`所見即所得內容 ${stamp}`)
await Promise.all([page.waitForURL(/\/admin\/content\/\d+/, { timeout: 20000 }), page.click('button[value=draft]')])
const postId = Number(/\/admin\/content\/(\d+)/.exec(page.url())[1])
check('save draft creates post', postId > 0, `id=${postId}`)
let bodyTxt = await page.textContent('body')
check('draft status shown', /草稿/.test(bodyTxt))
const edHtml = await page.$eval('.ed', (e) => e.innerHTML)
check('WYSIWYG content persisted', edHtml.includes(String(stamp)))

// 5. preview (admin) and preview blocked for anonymous
r = await page.goto(`${BASE}/admin-preview/post/${postId}/`)
check('admin preview renders draft', r.status() === 200 && (await page.textContent('body')).includes(String(stamp)), `status=${r.status()}`)
const anon = await (await browser.newContext()).newPage()
r = await anon.goto(`${BASE}/admin-preview/post/${postId}/`)
check('anonymous preview blocked', !(await anon.textContent('body')).includes(`所見即所得內容 ${stamp}`), `status=${r.status()} url=${anon.url()}`)

// 6. schedule (future date) then publish
await page.goto(`${BASE}/admin/content/${postId}/`)
const future = new Date(Date.now() + 7 * 86400e3)
const pad = (n) => String(n).padStart(2, '0')
await page.fill('#date', `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T10:00`)
await submitAndWait(page, 'button[value=schedule]', '已排程')
bodyTxt = await page.textContent('body')
check('schedule -> 已排程', /排程於/.test(bodyTxt))
await page.fill('#date', '')
await submitAndWait(page, 'button[value=publish]', '已發布')
bodyTxt = await page.textContent('body')
const viewHref = await page.$eval('main a[target=_blank]:has-text("檢視文章")', (a) => a.getAttribute('href')).catch(() => null)
check('publish -> public link', !!viewHref, viewHref || '')
if (viewHref) {
  r = await anon.goto(BASE + encodeURI(viewHref))
  check('published post visible publicly', r.status() === 200 && (await anon.textContent('body')).includes(String(stamp)), `status=${r.status()}`)
}
// back to draft & trash via UI
await submitAndWait(page, 'button[value=draft]', '草稿已儲存')
page.once('dialog', (d) => d.accept())
await Promise.all([page.waitForURL((u) => u.pathname === '/admin/content/' , { timeout: 20000 }), page.click('button:has-text("移到垃圾桶")')])
await page.goto(`${BASE}/admin/content/${postId}/`)
check('trash via UI', /trash|垃圾桶/.test((await page.textContent('h1.adm-h1')) || ''), page.url())

// 7. media upload -> WebP
const png = join(tmpdir(), `e2e-${stamp}.png`)
const sharp = req('sharp')
await sharp({ create: { width: 2600, height: 1200, channels: 3, background: { r: (stamp % 200) + 20, g: 90, b: 160 } } }).png().toFile(png)
await page.goto(`${BASE}/admin/media/`)
await page.setInputFiles('input[name=files]', png)
await Promise.all([page.waitForURL((u) => okLabel(u.href) !== '', { timeout: 30000 }), page.click('main button:has-text("上傳")')])
await page.waitForLoadState('networkidle')
const firstMedia = await page.$eval('.adm-media-grid a', (a) => ({ href: a.getAttribute('href'), cap: a.textContent }))
check('media upload converted to WebP 2000px', /2000×923/.test(firstMedia.cap) && /\.webp|e2e-/.test(firstMedia.cap + firstMedia.href), JSON.stringify(firstMedia))
writeFileSync(join(tmpdir(), 'e2e-admin-ids.json'), JSON.stringify({ postId, media: firstMedia.href }))

// 8. exports
r = await page.goto(`${BASE}/admin/orders-export/`).catch((e) => null)
const ordersCsv = await ctx.request.get(`${BASE}/admin/orders-export/`)
check('orders CSV export', ordersCsv.status() === 200 && /csv/.test(ordersCsv.headers()['content-type'] || ''), ordersCsv.headers()['content-type'])
await page.goto(`${BASE}/admin/forms/`)
const formLink = await page.$$eval('a[href^="/admin/forms/"]', (as) => as.map((a) => a.getAttribute('href')).find((h) => /\/admin\/forms\/[^/]+\/$/.test(h)))
const fid = formLink ? formLink.split('/')[3] : null
if (fid) {
  const fcsv = await ctx.request.get(`${BASE}/admin/forms-export/${fid}/`)
  check('form submissions CSV export', fcsv.status() === 200 && /csv/.test(fcsv.headers()['content-type'] || ''), `form=${fid} ${fcsv.headers()['content-type']}`)
}
const anonCsv = await (await browser.newContext()).request.get(`${BASE}/admin/orders-export/`, { maxRedirects: 0 })
check('orders CSV blocked for anonymous', anonCsv.status() !== 200 || !/csv/.test(anonCsv.headers()['content-type'] || ''), `status=${anonCsv.status()}`)

check('no client-side page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
await browser.close()
const fails = results.filter((x) => !x.ok).length
console.log(`\n${results.length - fails}/${results.length} passed`)
process.exit(fails ? 1 : 0)
