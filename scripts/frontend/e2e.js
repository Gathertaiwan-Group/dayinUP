// Browser smoke test of interactive features. Usage:
//   NODE_PATH=~/gather-migrate/_tools/node_modules node scripts/frontend/e2e.js http://localhost:3456 <shotdir>
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment so the test order it places
// is deleted afterwards (order_items / order_notes cascade). Cleanup also runs if a step throws.
const { chromium } = require('playwright')
const BASE = process.argv[2]
const OUT = process.argv[3] || '/tmp'
const results = []
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`) }
const TEST_EMAIL = 'migration-test@gathertaiwan.com'
const TEST_MARK = 'DAYINUP-FRONTEND-TEST'
// Delete every order this script created: new-site ids (>= 1000000, imported WP ids are lower),
// test billing email, and the marker in the customer note. Never touches imported orders.
async function cleanupTestOrders() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { results.push('FAIL cleanup: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set, test order left behind'); return }
  const q = `id=gte.1000000&billing_email=eq.${encodeURIComponent(TEST_EMAIL)}&customer_note=like.*${TEST_MARK}*`
  const r = await fetch(`${url}/rest/v1/orders?${q}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Profile': 'site_dayinup', Prefer: 'return=representation' },
  })
  const rows = r.ok ? await r.json() : []
  ok('cleanup test orders', r.ok, `deleted ${rows.length} (${rows.map((o) => o.id).join(',')})`)
  // newsletter test submission (Elementor form stores the field as form_fields[email])
  const contains = encodeURIComponent(JSON.stringify({ 'form_fields[email]': TEST_EMAIL }))
  const f = await fetch(`${url}/rest/v1/form_submissions?id=gte.1000000&data=cs.${contains}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Profile': 'site_dayinup', Prefer: 'return=representation' },
  })
  const frows = f.ok ? await f.json() : []
  ok('cleanup test form submissions', f.ok, `deleted ${frows.length}`)
}
;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  try {
  // ---------- desktop shop flow
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  // traffic discipline: images are not under test here, so they are not downloaded (E2E_IMAGES=1 to allow)
  const noImages = (c) => process.env.E2E_IMAGES === '1' ? null : c.route('**/*', (r) => (['image', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue()))
  await noImages(ctx)
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(BASE + '/product/party-2025-09-14/', { waitUntil: 'networkidle' })
  ok('variation button disabled before select', await p.locator('.single_add_to_cart_button.disabled').count() === 1)
  await p.click('label[for*="早鳥票"]')
  await p.waitForTimeout(300)
  const priceTxt = await p.locator('.single_variation .woocommerce-variation-price').innerText()
  ok('variation price shown', /774/.test(priceTxt), JSON.stringify(priceTxt))
  ok('discount line shown', /9 折|9折/.test(await p.locator('.single_variation').innerText()))
  await p.click('.quantity .ct-increase')
  ok('qty increments', (await p.inputValue('input.qty')) === '2')
  await p.click('.single_add_to_cart_button')
  await p.waitForSelector('.woocommerce-message', { timeout: 10000 })
  ok('added to cart notice', /已加入您的購物車/.test(await p.locator('.woocommerce-message').first().innerText()))
  await p.waitForTimeout(500)
  ok('header cart badge = 2', (await p.locator('.ct-dynamic-count-cart').first().innerText()).trim() === '2')
  // gallery lightbox
  await p.click('.woocommerce-product-gallery figure')
  ok('lightbox opens', await p.locator('.dayinup-lightbox img').count() === 1)
  await p.keyboard.press('Escape')
  // tabs
  await p.click('#tab-title-additional_information a')
  ok('additional info tab', await p.locator('#tab-additional_information').isVisible())
  // cart
  await p.goto(BASE + '/cart/', { waitUntil: 'networkidle' })
  await p.waitForSelector('.wc-block-cart-items__row')
  ok('cart shows line', /早鳥票/.test(await p.locator('.wc-block-cart-items').innerText()))
  await p.click('.wc-block-components-quantity-selector__button--plus')
  await p.waitForFunction(() => document.querySelector('.wc-block-components-quantity-selector__input')?.value === '3', null, { timeout: 10000 }).catch(() => {})
  ok('cart qty +1 → 3', (await p.inputValue('.wc-block-components-quantity-selector__input')) === '3')
  await p.screenshot({ path: OUT + '/e2e_cart.png' })
  await p.click('.wc-block-cart__submit-button')
  await p.waitForURL('**/checkout/')
  await p.waitForSelector('#billing-email')
  await p.fill('#billing-email', TEST_EMAIL)
  await p.fill('#billing-last_name', '搬遷')
  await p.fill('#billing-first_name', '測試')
  await p.fill('#billing-address_1', '測試路1號')
  await p.fill('#billing-city', '大安區')
  await p.selectOption('#billing-state', '臺北市')
  await p.fill('#billing-postcode', '106')
  await p.fill('#billing-phone', '0912345678')
  await p.check('#checkbox-control-note')
  await p.fill('textarea', TEST_MARK + ' e2e order, safe to delete')
  await p.screenshot({ path: OUT + '/e2e_checkout.png', fullPage: true })
  await p.click('.wc-block-components-checkout-place-order-button')
  await p.waitForURL('**/order-received/**', { timeout: 20000 })
  await p.waitForSelector('.woocommerce-order-overview')
  const ov = await p.locator('.woocommerce-order-overview').innerText()
  ok('order received page (pending)', /待付款/.test(ov) && /2,322/.test(ov), ov.replace(/\s+/g, ' ').slice(0, 120))
  await p.screenshot({ path: OUT + '/e2e_order.png' })
  // search modal
  await p.goto(BASE + '/', { waitUntil: 'networkidle' })
  await p.click('[data-id="search"]')
  ok('search modal opens', await p.locator('#search-modal.active').count() === 1)
  await p.fill('#search-modal input[name=s]', 'talk')
  await p.keyboard.press('Enter')
  await p.waitForURL(/[?]s=talk/)
  ok('search results', (await p.locator('.entries article').count()) >= 3)
  // account modal
  await p.click('[data-id="account"] a')
  ok('account modal opens', await p.locator('#account-modal.active').count() === 1)
  await p.click('#account-modal li.ct-register')
  ok('register tab', await p.locator('#account-modal .ct-register-form.active').count() === 1)
  await p.click('#account-modal li.ct-login')
  await p.fill('#user_login', 'nobody@gathertaiwan.com'); await p.fill('#user_pass', 'wrong-password')
  await p.click('#loginform button')
  await p.waitForSelector('#loginform .dayinup-form-msg')
  ok('login error shown', /不正確/.test(await p.locator('#loginform .dayinup-form-msg').innerText()))
  // sticky header
  await p.goto(BASE + '/guide-case-78/', { waitUntil: 'networkidle' })
  await p.mouse.wheel(0, 1500); await p.waitForTimeout(400)
  ok('sticky header active', (await p.locator('[data-device="desktop"] [data-sticky]').getAttribute('data-sticky')).includes('yes'))
  ok('TOC built', (await p.locator('.elementor-toc__list-item').count()) > 3)
  ok('back-to-top visible', await p.locator('.ct-back-to-top.ct-show').count() === 1)
  // newsletter + comment forms in the browser
  await p.goto(BASE + '/feedback/', { waitUntil: 'networkidle' })
  if (await p.locator('form.elementor-form input[type=email]').count()) {
    await p.fill('form.elementor-form input[type=email]', 'migration-test@gathertaiwan.com')
    await p.click('form.elementor-form button[type=submit]')
    await p.waitForSelector('form.elementor-form .dayinup-form-msg')
    ok('newsletter submit', /訂閱/.test(await p.locator('form.elementor-form .dayinup-form-msg').innerText()))
  } else ok('newsletter form present', false)
  // ---------- mobile: drawer menu
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await noImages(m)
  const mp = await m.newPage()
  await mp.goto(BASE + '/', { waitUntil: 'networkidle' })
  await mp.tap('[data-device="mobile"] .ct-header-trigger')
  await mp.waitForTimeout(400)
  ok('mobile drawer opens', await mp.locator('#offcanvas.active').count() === 1)
  await mp.tap('#offcanvas .ct-toggle-dropdown-mobile >> nth=0')
  await mp.waitForTimeout(300)
  ok('mobile submenu expands', await mp.locator('#offcanvas li.dropdown-active .sub-menu').isVisible())
  await mp.screenshot({ path: OUT + '/e2e_mobile_menu.png' })
  ok('no JS page errors', errors.length === 0, errors.join(' | ').slice(0, 300))
  } catch (e) {
    results.push('FAIL exception ' + String(e).slice(0, 300))
  } finally {
    await cleanupTestOrders()
    await b.close()
    console.log(results.join('\n'))
  }
})()
