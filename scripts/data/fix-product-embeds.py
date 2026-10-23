#!/usr/bin/env python3
"""Restore oEmbed iframes that the WC Store API stripped from product descriptions.

usage: python3 -I fix-product-embeds.py <exportDir> [--apply]
env:   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (never printed)

The importer took product descriptions from the Store API, which returns
`<div class="wp-block-embed__wrapper"></div>` with the iframe removed. The WP REST
`content.rendered` (export/rest/product.json) still has the iframes, so fill each
empty wrapper, in document order, with the matching iframe from content.rendered.
"""
import json, os, re, sys, urllib.request

EXPORT = sys.argv[1]
APPLY = '--apply' in sys.argv
URL = os.environ['SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
H = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Accept-Profile': 'site_dayinup',
     'Content-Profile': 'site_dayinup', 'Content-Type': 'application/json'}

WRAP_RE = re.compile(r'(<div class="wp-block-embed__wrapper">)(.*?)(</div>)', re.S)
IFRAME_RE = re.compile(r'<iframe\b.*?</iframe>', re.S)


def restore_embeds(desc, rendered):
    src = [m.group(2).strip() for m in WRAP_RE.finditer(rendered or '')]
    if not src:
        return desc
    it = iter(src)

    def fill(m):
        inner = next(it, None)
        if m.group(2).strip() or inner is None or not IFRAME_RE.search(inner):
            return m.group(0)
        return m.group(1) + '\n' + inner + '\n' + m.group(3)
    return WRAP_RE.sub(fill, desc)


def req(method, path, body=None):
    r = urllib.request.Request(URL + '/rest/v1/' + path, method=method, headers=H,
                               data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r) as f:
        t = f.read()
        return json.loads(t) if t else None


rendered = {p['id']: p['content']['rendered'] for p in json.load(open(os.path.join(EXPORT, 'rest/product.json')))}
rows = req('GET', 'products?select=id,path,description_html')
changed = 0
for row in rows:
    d = row['description_html'] or ''
    new = restore_embeds(d, rendered.get(row['id']))
    if new != d:
        changed += 1
        print('fix', row['id'], row['path'], d.count('<iframe'), '->', new.count('<iframe'))
        if APPLY:
            req('PATCH', 'products?id=eq.%d' % row['id'], {'description_html': new})
print('changed', changed, 'applied' if APPLY else '(dry run)')
