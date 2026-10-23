#!/usr/bin/env python3
"""Generate theme assets for the Next.js front-end from the read-only export.

Reads  ~/gather-migrate/dayinUP/export/{design,html}  (NOT in repo)
Writes repo/public/wp-content/**   original theme/plugin CSS + fonts (GPL code, URL-rewritten)
       repo/public/wp-css/inline.css   head inline <style> blocks shared by the theme
       repo/src/generated/chrome.json  header / footer / drawers markup (menus are placeholders)
       repo/src/generated/pages.json   per-path body attributes + Elementor CSS list
Media URLs are rewritten through site_dayinup.media_url_map (public read via PostgREST).
Usage:  source ~/.config/gather-migrate/env && python3 scripts/frontend/gen_assets.py
"""
import json, os, re, shutil, hashlib, unicodedata, urllib.request, urllib.parse, html as htmlmod

HOME = os.path.expanduser('~')
EXPORT = os.path.join(HOME, 'gather-migrate/dayinUP/export')
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DESIGN = os.path.join(EXPORT, 'design', 'dayinup.com')
HTML = os.path.join(EXPORT, 'html')
PUB = os.path.join(REPO, 'public')
GEN = os.path.join(REPO, 'src', 'generated')
os.makedirs(GEN, exist_ok=True)

# ---------------------------------------------------------------- media map
def load_media_map():
    url = os.environ['SUPABASE_URL'] + '/rest/v1/media_url_map?select=old_path,new_url'
    out, start = {}, 0
    while True:
        req = urllib.request.Request(url, headers={
            'apikey': os.environ['SUPABASE_ANON_KEY'], 'Accept-Profile': 'site_dayinup',
            'Range-Unit': 'items', 'Range': f'{start}-{start+999}'})
        rows = json.load(urllib.request.urlopen(req))
        for r in rows:
            out[unicodedata.normalize('NFC', r['old_path'])] = r['new_url']
        if len(rows) < 1000:
            break
        start += 1000
    return out

MEDIA = load_media_map()
print('media map', len(MEDIA))

UP_RE = re.compile(r'(?:https?:)?(?://(?:go\.)?dayinup\.com)?(/wp-content/uploads/[^"\'\s\),<>]+?\.(?:jpe?g|png|gif|webp|svg|pdf|mp4|ico))', re.I)

def map_upload(m):
    p = m.group(1)
    key = unicodedata.normalize('NFC', urllib.parse.unquote(htmlmod.unescape(p)))
    if '/uploads/elementor/' in key or '/uploads/blocksy/' in key:
        return p
    return MEDIA.get(key) or MEDIA.get(re.sub(r'-\d+x\d+(?=\.\w+$)', '', key)) or MEDIA.get(re.sub(r'-\d+x\d+(?=\.\w+$)', '-scaled', key)) or p

def rewrite_urls(s):
    s = UP_RE.sub(map_upload, s)
    s = re.sub(r'https?://(?:go\.)?dayinup\.com(?=["\'])', '/', s)
    s = re.sub(r'https?://(?:go\.)?dayinup\.com(?=/)', '', s)
    s = s.replace('https:\\/\\/dayinup.com', '')
    return s

def cf_decode(hexstr):
    k = int(hexstr[:2], 16)
    return ''.join(chr(int(hexstr[i:i+2], 16) ^ k) for i in range(2, len(hexstr), 2))

def fix_cf_email(s):
    s = re.sub(r'href="/cdn-cgi/l/email-protection#([0-9a-f]+)"', lambda m: 'href="mailto:' + htmlmod.escape(htmlmod.unescape(cf_decode(m.group(1)))) + '"', s)
    s = re.sub(r'<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="([0-9a-f]+)">\[email&#160;protected\]</a>',
               lambda m: htmlmod.escape(htmlmod.unescape(cf_decode(m.group(1)))), s)
    return s

# ---------------------------------------------------------------- CSS + fonts
css_dst = os.path.join(PUB, 'wp-content')
if os.path.isdir(css_dst):
    shutil.rmtree(css_dst)
n = 0
for root, _, files in os.walk(os.path.join(DESIGN, 'wp-content')):
    for f in files:
        src = os.path.join(root, f)
        rel = os.path.relpath(src, DESIGN)
        dst = os.path.join(PUB, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if f.endswith('.css'):
            s = open(src, encoding='utf-8', errors='replace').read()
            s = rewrite_urls(s)
            s = s.replace('body.elementor-page-', '.elementor-page-')
            open(dst, 'w', encoding='utf-8').write(s)
        else:
            shutil.copyfile(src, dst)
        n += 1
print('copied theme files', n)

# ---------------------------------------------------------------- scan snapshots
idx = json.load(open(os.path.join(HTML, 'index.json')))
def path_of(url):
    u = urllib.parse.urlsplit(url)
    p = unicodedata.normalize('NFC', urllib.parse.unquote(u.path or '/'))
    return p + (('?' + urllib.parse.unquote(u.query)) if u.query else '')

LINK_RE = re.compile(r"<link rel=['\"]stylesheet['\"] id=['\"]([^'\"]+)['\"] href=['\"]([^'\"]+)['\"]")
STYLE_RE = re.compile(r'<style([^>]*)>(.*?)</style>', re.S)
SKIP_STYLE = {'9e02a785'}  # elementor lazy-load background suppression (needs Elementor JS)
global_links, inline_blocks, inline_seen = [], [], set()
pages = {}
link_count = {}
for it in idx:
    f = os.path.join(HTML, it['file'])
    if not os.path.exists(f):
        continue
    h = open(f, encoding='utf-8', errors='replace').read()
    head_end = h.find('</head>')
    head = h[:head_end]
    hrefs = []
    for _id, href in LINK_RE.findall(head):
        if '//go.dayinup.com/' in href:
            # Elementor Google-Fonts CSS pointed at go.dayinup.com, which does not resolve: live visitors (and the
            # reference screenshots) got the fallback system font. Keep that behaviour; files stay in public/ for opt-in.
            continue
        href = re.sub(r'\?.*$', '', href)
        href = re.sub(r'^https?://(?:go\.)?dayinup\.com', '', href)
        hrefs.append(href)
        link_count[href] = link_count.get(href, 0) + 1
        if '/uploads/elementor/css/post-' not in href and href not in global_links:
            global_links.append(href)
    for attrs, body in STYLE_RE.findall(head):
        k = hashlib.md5(body.encode()).hexdigest()[:8]
        if k in SKIP_STYLE or k in inline_seen:
            continue
        inline_seen.add(k)
        inline_blocks.append(f'/* {attrs.strip()} {k} */\n' + body)
    bm = re.search(r'<body([^>]*)>', h)
    battrs = dict(re.findall(r'([\w-]+)="([^"]*)"', bm.group(1))) if bm else {}
    ttl = re.search(r'<title>(.*?)</title>', head, re.S)
    pages[path_of(it['url'])] = {
        'class': battrs.get('class', ''),
        'prefix': battrs.get('data-prefix', ''),
        'elementor': [x for x in hrefs if '/uploads/elementor/css/post-' in x],
        'status': it.get('status'),
        'title': htmlmod.unescape(ttl.group(1).strip()) if ttl else '',
    }

css_inline = rewrite_urls('\n'.join(inline_blocks)).replace('body.elementor-page-', '.elementor-page-')
os.makedirs(os.path.join(PUB, 'wp-css'), exist_ok=True)
open(os.path.join(PUB, 'wp-css', 'inline.css'), 'w').write(css_inline)
print('inline css blocks', len(inline_blocks), len(css_inline))

# only keep stylesheets that exist locally
def exists(href):
    return os.path.exists(os.path.join(PUB, href.lstrip('/')))
missing = [x for x in global_links if not exists(x)]
global_links = [x for x in global_links if exists(x)]
for p in pages.values():
    p['elementor'] = [x for x in p['elementor'] if exists(x)]
print('global css', len(global_links), 'missing', missing)

# ---------------------------------------------------------------- chrome (from a plain page)
h = open(os.path.join(HTML, 'sample-page.html'), encoding='utf-8').read()
def cut(s, a, b):
    i = s.find(a); j = s.find(b, i)
    assert i >= 0 and j >= 0, (a, b)
    return s[i:j]
drawer_start = cut(h, '<div class="ct-drawer-canvas" data-location="start">', '<div id="main-container">')
header = cut(h, '<header id="header"', '<main id="main"')
footer = cut(h, '<footer id="footer"', '</div>\n\n<script')
fe = h.find('<div class="ct-drawer-canvas" data-location="end">')
drawer_end = h[fe:h.find('</div></div>', fe) + len('</div></div>')]

def clean(s):
    s = fix_cf_email(s)
    s = rewrite_urls(s)
    s = re.sub(r'<input type="hidden" (?:id="blocksy-[a-z]+-nonce" )?name="(?:blocksy-[a-z]+-nonce|_wp_http_referer)"[^>]*/?>', '', s)
    s = re.sub(r'<input type="hidden" value="[0-9a-f]+" class="ct-live-results-nonce">', '', s)
    s = s.replace('action="/wp-login.php"', 'action="#"')
    return s

# replace menus with placeholders
header = re.sub(r'<ul id="menu-main" class="menu">.*?</ul></nav>', '<!--MENU:main--></nav>', header, flags=re.S)
drawer_start = re.sub(r'<ul id="menu-main-1" class="">.*?</ul></nav>', '<!--MENU:mobile--></nav>', drawer_start, flags=re.S)
assert '<!--MENU:main-->' in header and '<!--MENU:mobile-->' in drawer_start
# floating bar belongs to product template only
drawer_start = re.sub(r'<div class="ct-floating-bar".*?</section>\s*</div>\s*</div>', '', drawer_start, flags=re.S)

svg = {}
for m in re.finditer(r'<span class="ct-toggle-dropdown-desktop">(<svg.*?</svg>)</span>', h, re.S):
    svg['dropdown_desktop'] = m.group(1); break
for m in re.finditer(r'<button class="ct-toggle-dropdown-mobile"[^>]*>(<svg.*?</svg>)</button>', h, re.S):
    svg['dropdown_mobile'] = m.group(1); break

chrome = {
    'drawer_start': clean(drawer_start),
    'header': clean(header),
    'footer': clean(footer),
    'drawer_end': clean(drawer_end),
    'svg': svg,
}
json.dump(chrome, open(os.path.join(GEN, 'chrome.json'), 'w'), ensure_ascii=False, indent=0)

# product page snippets (share box icons etc.) from a post and product
post = open(os.path.join(HTML, 'guide-case-78.html'), encoding='utf-8').read()
snip = {}
m = re.search(r'<div class="ct-share-box.*?</div>\s*</div>', post, re.S); snip['share_box'] = m.group(0)
m = re.search(r'<nav class="ct-breadcrumbs".*?</nav>', post, re.S)
sv = re.findall(r'<svg.*?</svg>', m.group(0), re.S); snip['breadcrumb_sep'] = sv[0] if sv else ''
m = re.search(r'<nav class="post-navigation.*?</nav>', post, re.S); snip['post_nav'] = m.group(0)
shop = open(os.path.join(HTML, 'shop.html'), encoding='utf-8').read()
m = re.search(r'<a class="next page-numbers"[^>]*>.*?(<svg.*?</svg>)</a>', shop, re.S); snip['next_svg'] = m.group(1)
srch = open(os.path.join(HTML, '_6543ee.html'), encoding='utf-8').read()
m = re.search(r'<form role="search" method="get" class="ct-search-form" data-form-controls.*?</form>', srch, re.S); snip['search_form'] = clean(m.group(0))
json.dump({k: clean(v) for k, v in snip.items()}, open(os.path.join(GEN, 'snippets.json'), 'w'), ensure_ascii=False, indent=0)

el_files = sorted(int(m.group(1)) for f in os.listdir(os.path.join(PUB, 'wp-content/uploads/elementor/css')) for m in [re.match(r'post-(\d+)\.css$', f)] if m)
default_og = MEDIA.get(unicodedata.normalize('NFC', '/wp-content/uploads/2025/04/文案用圖｜Blog：【平台計畫】封面（有字有底）-1024x576.jpeg'))
print('default og', default_og)
json.dump({'global_css': global_links, 'elementor_files': el_files, 'default_og_image': default_og, 'pages': pages}, open(os.path.join(GEN, 'pages.json'), 'w'), ensure_ascii=False, indent=0)
print('pages', len(pages))

# ---------------------------------------------------------------- Stackable block-id map
# Stackable assigns random block ids per render, so ids in content stored from the REST API differ from the ids
# the live page used (and its <style class="stk-block-styles"> CSS).  Map DB ids -> snapshot ids by order.
def rest_get(path):
    req = urllib.request.Request(os.environ['SUPABASE_URL'] + '/rest/v1/' + path, headers={'apikey': os.environ['SUPABASE_ANON_KEY'], 'Accept-Profile': 'site_dayinup'})
    return json.load(urllib.request.urlopen(req))
BID = re.compile(r'data-block-id="([a-z0-9]+)"')
file_by_path = {}
for it in idx:
    u = urllib.parse.urlsplit(it['url'])
    if u.query:
        continue
    file_by_path[unicodedata.normalize('NFC', urllib.parse.unquote(u.path))] = it['file']
stk_map = {}
items = [(r['id'], r['path'], r['content_html'] or '') for r in rest_get('posts?select=id,path,content_html&status=eq.publish')]
items += [(r['id'], r['path'], (r['short_description_html'] or '') + (r['description_html'] or '')) for r in rest_get('products?select=id,path,description_html,short_description_html')]
for pid, path, html in items:
    dbids = BID.findall(html)
    f = file_by_path.get(path)
    if not dbids or not f:
        continue
    page = open(os.path.join(HTML, f), encoding='utf-8').read()
    snap = BID.findall(page[page.find('<main'):page.find('</main>')])
    if dbids != snap and len(dbids) == len(snap):
        stk_map[str(pid)] = dict(zip(dbids, snap))
json.dump(stk_map, open(os.path.join(GEN, 'stk_map.json'), 'w'))
print('stackable id maps', len(stk_map))
