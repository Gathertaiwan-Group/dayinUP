#!/usr/bin/env python3
"""Compare <title>, meta description, robots, canonical, og:title/og:type and JSON-LD presence between the
old-site HTML snapshots (export/html) and the new site.  Usage: python3 scripts/frontend/check_seo.py http://localhost:3456"""
import json, os, re, sys, html, urllib.request, urllib.parse, urllib.error
base = sys.argv[1].rstrip('/')
EXP = os.path.expanduser('~/gather-migrate/dayinUP/export')
idx = json.load(open(os.path.join(EXP, 'html/index.json')))
def tags(h):
    head = h[:h.find('</head>')] if '</head>' in h else h
    def meta(attr, name):
        m = re.search(r'<meta[^>]*%s="%s"[^>]*content="([^"]*)"' % (attr, re.escape(name)), head) or re.search(r'<meta[^>]*content="([^"]*)"[^>]*%s="%s"' % (attr, re.escape(name)), head)
        return html.unescape(m.group(1)).strip() if m else None
    t = re.search(r'<title[^>]*>(.*?)</title>', head, re.S)
    c = re.search(r'<link[^>]*rel="canonical"[^>]*href="([^"]*)"', head) or re.search(r'<link[^>]*href="([^"]*)"[^>]*rel="canonical"', head)
    canon = urllib.parse.unquote(html.unescape(c.group(1))).replace('https://dayinup.com', '') if c else None
    return {
        'title': html.unescape(t.group(1)).strip() if t else None,
        'description': meta('name', 'description'),
        'robots': meta('name', 'robots'),
        'canonical': canon,
        'og:title': meta('property', 'og:title'),
        'og:type': meta('property', 'og:type'),
        'ld+json': 'application/ld+json' in h,
    }
keys = ['title', 'description', 'robots', 'canonical', 'og:title', 'og:type', 'ld+json']
tot = {k: [0, 0] for k in keys}
diffs = []
for it in idx:
    if it.get('status') != 200:
        continue
    f = os.path.join(EXP, 'html', it['file'])
    if not os.path.exists(f):
        continue
    old = tags(open(f, encoding='utf-8', errors='replace').read())
    u = urllib.parse.urlsplit(it['url'])
    try:
        new_h = urllib.request.urlopen(urllib.request.Request(base + u.path + (('?' + u.query) if u.query else ''), headers={'User-Agent': 'GatherMigrator/1.0'}), timeout=60).read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        new_h = e.read().decode('utf-8', 'replace')
    new = tags(new_h)
    for k in keys:
        same = (old[k] or None) == (new[k] or None)
        tot[k][0 if same else 1] += 1
        if not same:
            diffs.append((u.path, k, old[k], new[k]))
print('field: same / different')
for k in keys: print(f'  {k}: {tot[k][0]} / {tot[k][1]}')
for d in diffs[:60]: print('  DIFF', d)
