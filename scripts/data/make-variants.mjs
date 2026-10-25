// Generate responsive WebP variants (480/960/1440w, quality 75, no upscaling) from the original WP uploads,
// upload them to site-dayinup/v/<w>/<storage_path> (immutable cache) and record them in site_dayinup.media.variants.
// usage: node scripts/data/make-variants.mjs <exportDir>   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from env)
// Idempotent: rows that already have variants are skipped unless --force.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const exportDir = process.argv[2]
const force = process.argv.includes('--force')
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY } = process.env
if (!exportDir || !SUPABASE_URL || !KEY) throw new Error('usage: node make-variants.mjs <exportDir> (env SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
const BUCKET = 'site-dayinup'
const WIDTHS = [480, 960, 1440]
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const REST = { ...H, 'Accept-Profile': 'site_dayinup', 'Content-Profile': 'site_dayinup' }

const r = await fetch(`${SUPABASE_URL}/rest/v1/media?select=id,storage_path,mime_type,width,height,variants,meta&mime_type=eq.image/webp&order=id`, { headers: REST })
if (!r.ok) throw new Error(`list media ${r.status} ${await r.text()}`)
const rows = await r.json()
const up = path.join(exportDir, 'media/uploads')
let i = 0, done = 0, skipped = 0, bytes = 0
const fail = []

async function one(m) {
  if (!force && Array.isArray(m.variants) && m.variants.length) return skipped++
  const src = m.meta?.source_file ? path.join(up, m.meta.source_file) : null
  if (!src || !fs.existsSync(src)) return fail.push([m.id, 'no source'])
  const variants = []
  for (const w of WIDTHS) {
    if (!m.width || w >= m.width) break // never upscale; the stored original covers the largest size
    const { data, info } = await sharp(src, { failOn: 'none' }).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer({ resolveWithObject: true })
    const key = `v/${w}/${m.storage_path.replace(/\.[A-Za-z0-9]+$/, '')}.webp`
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'image/webp', 'x-upsert': 'true', 'cache-control': 'public, max-age=31536000, immutable' },
      body: data,
    })
    if (!res.ok) return fail.push([m.id, w, res.status, (await res.text()).slice(0, 160)])
    variants.push({ w: info.width, h: info.height, path: key, bytes: data.length })
    bytes += data.length
  }
  const p = await fetch(`${SUPABASE_URL}/rest/v1/media?id=eq.${m.id}`, {
    method: 'PATCH',
    headers: { ...REST, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ variants }),
  })
  if (!p.ok) return fail.push([m.id, 'patch', p.status, (await p.text()).slice(0, 160)])
  done++
}

async function worker() {
  while (i < rows.length) await one(rows[i++])
}
await Promise.all([1, 2, 3, 4].map(worker))
console.log(JSON.stringify({ media: rows.length, updated: done, skipped, variant_MB: +(bytes / 1048576).toFixed(2), failed: fail.length }))
if (fail.length) console.log(JSON.stringify(fail.slice(0, 10)))
