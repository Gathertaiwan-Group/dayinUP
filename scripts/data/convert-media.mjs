// Convert WP originals (excluding -WxH / -scaled variants) to WebP for bucket site-dayinup.
// usage: node convert-media.mjs <exportDir> <outDir>
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(process.env.TOOLS_NODE_MODULES ? process.env.TOOLS_NODE_MODULES + '/' : import.meta.url);
const sharp = require('sharp');
const [exportDir, outDir] = process.argv.slice(2);
const up = path.join(exportDir, 'media/uploads');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(path.relative(up, p).normalize('NFC')); } })(up);
const pat = /^(.*?)((?:-scaled|-\d+x\d+|-rotated|-e\d{10,})*)(\.[A-Za-z0-9]+)$/;
const groups = new Map();
for (const f of files) { const m = f.match(pat); const key = m[1] + m[3].toLowerCase(); if (!groups.has(key)) groups.set(key, []); groups.get(key).push({ f, suf: m[2] }); }
const rank = (s) => s === '' ? 0 : s === '-scaled' ? 1 : !/-\d+x\d+/.test(s) ? 2 : 3;
const area = (s) => { const m = s.match(/-(\d+)x(\d+)$/); return m ? +m[1] * +m[2] : 0; };
function asciiKey(rel) {
  const dir = path.dirname(rel); const base = path.basename(rel, path.extname(rel));
  let a = base.normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
  const h = crypto.createHash('sha1').update(base).digest('hex').slice(0, 8);
  return `${dir}/${a ? a + '-' : ''}${h}`;
}
const out = [];
for (const [key, vs] of groups) {
  vs.sort((a, b) => rank(a.suf) - rank(b.suf) || area(b.suf) - area(a.suf));
  const src = vs[0]; const ext = path.extname(key).toLowerCase();
  const k = asciiKey(key);
  const passthrough = ['.gif', '.svg', '.pdf', '.mp4', '.webm', '.mov'].includes(ext);
  const objKey = 'uploads/' + k + (passthrough ? ext : '.webp');
  const dest = path.join(outDir, objKey);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let width = null, height = null;
  if (!fs.existsSync(dest)) {
    if (passthrough) fs.copyFileSync(path.join(up, src.f), dest);
    else await sharp(path.join(up, src.f), { failOn: 'none' }).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(dest);
  }
  if (!passthrough) { const md = await sharp(dest).metadata(); width = md.width; height = md.height; }
  out.push({ group: key, source_file: src.f, variants: vs.map(v => v.f), object_key: objKey, mime: passthrough ? (ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream') : 'image/webp', bytes: fs.statSync(dest).size, width, height });
}
fs.writeFileSync(path.join(outDir, 'media-map.json'), JSON.stringify(out, null, 1));
console.log('groups', out.length, 'bytes', out.reduce((s, o) => s + o.bytes, 0));
