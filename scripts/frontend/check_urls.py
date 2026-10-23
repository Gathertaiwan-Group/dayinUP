#!/usr/bin/env python3
"""Request every URL from export/urls.json against a new-site base URL and report status codes.
Usage: python3 scripts/frontend/check_urls.py http://localhost:3456"""
import json, os, sys, urllib.request, urllib.parse, urllib.error
base = sys.argv[1].rstrip('/')
urls = json.load(open(os.path.expanduser('~/gather-migrate/dayinUP/export/urls.json')))['urls']
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
op = urllib.request.build_opener(NoRedirect)
res = {}
bad = []
for it in urls:
    u = urllib.parse.urlsplit(it['url'])
    path = u.path + (('?' + u.query) if u.query else '')
    try:
        r = op.open(urllib.request.Request(base + path, headers={'User-Agent': 'GatherMigrator/1.0'}), timeout=60)
        code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    res[code] = res.get(code, 0) + 1
    if code != 200:
        bad.append((code, path))
print('total', len(urls), 'status counts', res)
for b in bad: print('  NON-200', b)
