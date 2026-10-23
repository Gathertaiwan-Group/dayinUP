// Screenshot the new site with the same settings as the original capture (export/screens/index.json)
// and compute a pixel difference per page.  Usage:
//   NODE_PATH=~/gather-migrate/_tools/node_modules node scripts/frontend/visual_diff.js http://localhost:3456 <outdir> [filter]
const { chromium } = require('playwright')
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')
const BASE = process.argv[2]
const OUT = process.argv[3]
const FILTER = process.argv[4] || ''
const EXP = path.join(process.env.HOME, 'gather-migrate/dayinUP/export')
const idx = JSON.parse(fs.readFileSync(path.join(EXP, 'screens/index.json'))).filter((e) => e.ok && e.file.includes(FILTER))
fs.mkdirSync(OUT, { recursive: true })
const VPS = { desktop: [{ width: 1440, height: 900 }, false], mobile: [{ width: 390, height: 844 }, true] }

async function diff(a, b, name) {
  const W = 360
  const ia = sharp(a), ib = sharp(b)
  const [ma, mb] = await Promise.all([ia.metadata(), ib.metadata()])
  const ha = Math.round((ma.height * W) / ma.width), hb = Math.round((mb.height * W) / mb.width)
  const H = Math.min(ha, hb, 6000)
  const ra = await sharp(a).resize(W, ha, { fit: 'fill' }).extract({ left: 0, top: 0, width: W, height: H }).removeAlpha().raw().toBuffer()
  const rb = await sharp(b).resize(W, hb, { fit: 'fill' }).extract({ left: 0, top: 0, width: W, height: H }).removeAlpha().raw().toBuffer()
  let bad = 0
  for (let i = 0; i < ra.length; i += 3) {
    if (Math.abs(ra[i] - rb[i]) + Math.abs(ra[i + 1] - rb[i + 1]) + Math.abs(ra[i + 2] - rb[i + 2]) > 60) bad++
  }
  const overlap = bad / (W * H)
  const heightPenalty = Math.abs(ha - hb) / Math.max(ha, hb)
  // side-by-side preview of the first 1600 css px (old | new)
  const PW = 700
  const top = async (f, m) => sharp(f).extract({ left: 0, top: 0, width: m.width, height: Math.min(m.height, Math.round(m.width * 1.2)) }).resize(PW).png().toBuffer()
  const [pa, pb] = await Promise.all([top(a, ma), top(b, mb)])
  const [qa, qb] = await Promise.all([sharp(pa).metadata(), sharp(pb).metadata()])
  await sharp({ create: { width: PW * 2 + 10, height: Math.max(qa.height, qb.height), channels: 3, background: '#ff00ff' } })
    .composite([{ input: pa, left: 0, top: 0 }, { input: pb, left: PW + 10, top: 0 }])
    .png()
    .toFile(path.join(OUT, 'cmp_' + name))
  return { overlap, heightPenalty, oldH: ma.height, newH: mb.height, score: overlap * (1 - heightPenalty) + heightPenalty }
}

;(async () => {
  const b = await chromium.launch()
  const ctx = {}
  const results = []
  for (const e of idx) {
    const [size, mob] = VPS[e.viewport]
    if (!ctx[e.viewport]) ctx[e.viewport] = await b.newContext({ viewport: size, isMobile: mob, hasTouch: mob, deviceScaleFactor: 1, userAgent: (mob ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 ' : 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 ') + 'GatherMigrator/1.0' })
    const pg = await ctx[e.viewport].newPage()
    const u = new URL(e.url)
    const target = BASE + u.pathname + u.search
    const name = path.basename(e.file)
    const shot = path.join(OUT, name)
    let status = null
    try {
      const r = await pg.goto(target, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => null)
      status = r ? r.status() : null
      await pg.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)) } window.scrollTo(0, 0) })
      await pg.waitForTimeout(1200)
      await pg.screenshot({ path: shot, fullPage: true, timeout: 60000 })
      const d = await diff(path.join(EXP, e.file), shot, name)
      results.push({ file: name, url: e.url, oldStatus: e.status, newStatus: status, ...d })
      console.log(name, status, 'diff', (d.overlap * 100).toFixed(1) + '%', 'h', d.oldH, '->', d.newH, 'score', d.score.toFixed(3))
    } catch (err) {
      console.log(name, 'ERROR', String(err).slice(0, 200))
      results.push({ file: name, url: e.url, error: String(err).slice(0, 200) })
    }
    await pg.close()
  }
  await b.close()
  results.sort((a, b) => (b.score ?? 1) - (a.score ?? 1))
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1))
})()
