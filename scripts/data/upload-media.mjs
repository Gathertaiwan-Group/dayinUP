// Upload converted media to Supabase Storage bucket site-dayinup (service role from env).
// usage: node upload-media.mjs <outDir>
import fs from 'node:fs'; import path from 'node:path';
const outDir = process.argv[2]; const BUCKET = 'site-dayinup';
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY } = process.env;
const map = JSON.parse(fs.readFileSync(path.join(outDir, 'media-map.json'), 'utf8'));
let i = 0, ok = 0, fail = [];
async function worker() {
  while (i < map.length) {
    const m = map[i++];
    const body = fs.readFileSync(path.join(outDir, m.object_key));
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${m.object_key.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST', headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': m.mime, 'x-upsert': 'true', 'cache-control': 'public, max-age=31536000' }, body });
    if (r.ok) ok++; else fail.push([m.object_key, r.status, (await r.text()).slice(0, 200)]);
  }
}
await Promise.all([1, 2, 3, 4].map(worker));
console.log('uploaded', ok, 'failed', fail.length); if (fail.length) console.log(JSON.stringify(fail.slice(0, 10)));
