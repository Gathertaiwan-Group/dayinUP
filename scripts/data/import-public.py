#!/usr/bin/env python3
"""Import DayinUP public WordPress/WooCommerce content into Supabase schema site_dayinup.

usage: python3 -I import-public.py <exportDir> <mediaOutDir>
env:   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (never printed)

Reads only the local export (rest/*.json, html/*.html, features.json, urls.json) and the
media-map.json produced by convert-media.mjs. Writes via PostgREST (Content-Profile: site_dayinup).
Idempotent: upserts on primary keys.
"""
import html as htmllib
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request

EXPORT, MEDIA_OUT = sys.argv[1], sys.argv[2]
SB_URL = os.environ['SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
SCHEMA = 'site_dayinup'
BUCKET = 'site-dayinup'
PUBLIC_BASE = f'{SB_URL}/storage/v1/object/public/{BUCKET}/'
OLD_HOST_RE = r'(?:https?:)?//(?:go\.|www\.)?dayinup\.com'


def load(rel):
    with open(os.path.join(EXPORT, rel), encoding='utf-8') as f:
        return json.load(f)


def nfc(s):
    return unicodedata.normalize('NFC', s)


def rest(method, table, rows=None, query='', prefer='resolution=merge-duplicates,return=minimal'):
    url = f'{SB_URL}/rest/v1/{table}{query}'
    data = json.dumps(rows, ensure_ascii=False).encode() if rows is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json',
        'Content-Profile': SCHEMA, 'Accept-Profile': SCHEMA, 'Prefer': prefer,
        'User-Agent': 'GatherMigrator/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {table} failed {e.code}: {e.read()[:500]!r}')


def upsert(table, rows, chunk=200):
    for i in range(0, len(rows), chunk):
        rest('POST', table, rows[i:i + chunk])
    print(f'  {table}: {len(rows)}')


def path_of(link):
    if not link:
        return None
    p = urllib.parse.urlsplit(link)
    path = nfc(urllib.parse.unquote(p.path)) or '/'
    return path + ('?' + p.query if p.query else '')


def ts(v):
    return (v + '+08:00') if v and len(v) == 19 else v


def ts_gmt(v):
    return (v + 'Z') if v and len(v) == 19 else v


# ------------------------------------------------------------------ media mapping
media_map = json.load(open(os.path.join(MEDIA_OUT, 'media-map.json'), encoding='utf-8'))
SUFFIX_RE = re.compile(r'^(.*?)((?:-scaled|-\d+x\d+|-rotated|-e\d{10,})*)(\.[A-Za-z0-9]+)$')
group_url = {}   # 'YYYY/MM/base.ext' (NFC, lower ext) -> new public url
variant_rows = {}
for g in media_map:
    url = PUBLIC_BASE + urllib.parse.quote(g['object_key'])
    group_url[nfc(g['group'])] = url
    for v in g['variants']:
        m = SUFFIX_RE.match(v)
        variant_rows[nfc('/wp-content/uploads/' + v)] = (url, g['group'], m.group(2))


def upload_new_url(rel):
    """rel = 'YYYY/MM/file-300x300.jpeg' (decoded) -> new url or None"""
    rel = nfc(rel.split('?')[0].split('#')[0])
    m = SUFFIX_RE.match(rel)
    if not m:
        return None
    return group_url.get(m.group(1) + m.group(3).lower())


UPLOAD_RE = re.compile(OLD_HOST_RE + r'/wp-content/uploads/([^\s"\'<>)\\,]+)')
LINK_RE = re.compile(OLD_HOST_RE + r'(/[^\s"\'<>)\\]*)?')
unresolved = set()


def rewrite(s):
    if not s:
        return s

    def up(m):
        new = upload_new_url(urllib.parse.unquote(htmllib.unescape(m.group(1))))
        if new:
            return new
        unresolved.add(m.group(0))
        return m.group(0)
    s = UPLOAD_RE.sub(up, s)
    s = LINK_RE.sub(lambda m: m.group(1) or '/', s)  # internal links -> site-relative
    return s


# Store API strips oEmbed iframes, leaving empty wp-block-embed__wrapper divs; refill them
# from WP REST content.rendered (same order).
_WRAP_RE = re.compile(r'(<div class="wp-block-embed__wrapper">)(.*?)(</div>)', re.S)


def restore_embeds(desc, rendered):
    src = [m.group(2).strip() for m in _WRAP_RE.finditer(rendered or '')]
    if not src or not desc:
        return desc
    it = iter(src)

    def fill(m):
        inner = next(it, None)
        if m.group(2).strip() or inner is None or '<iframe' not in inner:
            return m.group(0)
        return m.group(1) + '\n' + inner + '\n' + m.group(3)
    return _WRAP_RE.sub(fill, desc)


def rewrite_json(v):
    return json.loads(rewrite(json.dumps(v, ensure_ascii=False))) if v is not None else None


# ------------------------------------------------------------------ SEO from html snapshots
html_index = {nfc(path_of(x['url'])): x['file'] for x in load('html/index.json') if x.get('status') == 200}


def seo_for(link):
    f = html_index.get(path_of(link) or '')
    if not f:
        return {}
    raw = open(os.path.join(EXPORT, 'html', f), encoding='utf-8', errors='replace').read()
    head = raw.split('</head>', 1)[0]
    out = {}
    m = re.search(r'<title[^>]*>(.*?)</title>', head, re.S)
    if m:
        out['title'] = htmllib.unescape(m.group(1).strip())
    for name, key in [('description', 'description'), ('robots', 'robots')]:
        m = re.search(r'<meta\s+name="%s"\s+content="([^"]*)"' % name, head)
        if m:
            out[key] = htmllib.unescape(m.group(1))
    for prop in ['og:title', 'og:description', 'og:image', 'og:type']:
        m = re.search(r'<meta\s+property="%s"\s+content="([^"]*)"' % prop, head)
        if m:
            out[prop.replace(':', '_')] = rewrite(htmllib.unescape(m.group(1)))
    m = re.search(r'<link\s+rel="canonical"\s+href="([^"]*)"', head)
    if m:
        out['canonical'] = path_of(m.group(1))
    m = re.search(r'<script type="application/ld\+json" class="rank-math-schema[^"]*">(.*?)</script>', head, re.S)
    if m:
        try:
            out['schema'] = json.loads(rewrite(m.group(1)))
        except Exception:
            pass
    return out


def main():
    root = load('rest/_root.json')
    types = load('rest/_types.json')
    taxes = load('rest/_taxonomies.json')
    users = load('rest/users.json')
    media = load('rest/media.json')
    posts = load('rest/posts.json')
    pages = load('rest/pages.json')
    navs = load('rest/navigation.json')
    products = load('rest/product.json')
    sprod = {p['id']: p for p in load('rest/store_products.json')}
    svars = load('rest/store_variations.json')
    cats = load('rest/tax_categories.json')
    tags = load('rest/tax_tags.json')
    pcats = load('rest/tax_product_cat.json')
    scats = {c['id']: c for c in load('rest/store_categories.json')}
    comments = load('rest/comments.json')
    features = load('features.json')
    wc = load('rest/wc_settings_from_html.json')
    menus_html = load('rest/menus_from_html.json')['home.html']
    urls = load('urls.json')['urls']

    print('post_types / taxonomies')
    upsert('post_types', [{
        'name': k, 'label': v.get('name') or k, 'rest_base': v.get('rest_base'),
        'hierarchical': bool(v.get('hierarchical')),
        'is_builtin': k in ('post', 'page', 'attachment', 'nav_menu_item', 'wp_block', 'wp_template',
                            'wp_template_part', 'wp_global_styles', 'wp_navigation', 'wp_font_family', 'wp_font_face'),
        'public': k in ('post', 'page', 'product', 'attachment'),
        'supports': {'slug': v.get('slug'), 'taxonomies': v.get('taxonomies', [])}} for k, v in types.items()])
    upsert('taxonomies', [{
        'name': k, 'label': v.get('name') or k, 'hierarchical': bool(v.get('hierarchical')),
        'object_types': v.get('types') or [], 'rest_base': v.get('rest_base')} for k, v in taxes.items()])

    print('authors')
    upsert('authors', [{
        'id': u['id'], 'slug': u['slug'], 'name': u['name'], 'url': u.get('url') or None,
        'description': u.get('description') or None,
        'avatar_url': (u.get('avatar_urls') or {}).get('96')} for u in users])
    author_ids = {u['id'] for u in users}

    print('media')
    mm_by_group = {nfc(g['group']): g for g in media_map}
    media_rows, seen_groups = [], set()
    for a in media:
        rel = nfc(urllib.parse.unquote(a['source_url'].split('/wp-content/uploads/', 1)[1]))
        m = SUFFIX_RE.match(rel)
        g = mm_by_group.get(m.group(1) + m.group(3).lower())
        if not g:
            print('  !! no converted file for media', a['id'], rel)
            continue
        seen_groups.add(g['group'])
        md = a.get('media_details') or {}
        media_rows.append({
            'id': a['id'], 'slug': a['slug'], 'title': htmllib.unescape(a['title']['rendered']),
            'alt_text': a.get('alt_text') or '',
            'caption_html': rewrite(a['caption']['rendered']),
            'description_html': rewrite(a['description']['rendered']),
            'mime_type': g['mime'], 'original_mime_type': a['mime_type'],
            'storage_path': g['object_key'], 'public_url': PUBLIC_BASE + urllib.parse.quote(g['object_key']),
            'width': g['width'], 'height': g['height'], 'bytes': g['bytes'],
            'original_url': a['source_url'], 'original_file': 'uploads/' + rel,
            'attachment_path': path_of(a['link']), 'parent_id': a.get('post'),
            'author_id': a['author'] if a.get('author') in author_ids else None,
            'status': a.get('status') or 'inherit',
            'date': ts(a['date']), 'modified': ts(a['modified']),
            'meta': {'source_group': g['group'], 'source_file': g['source_file'],
                     'original_dimensions': [md.get('width'), md.get('height')],
                     'original_filesize': md.get('filesize') or a.get('filesize')}})
    upsert('media', media_rows)
    media_ids = {r['id'] for r in media_rows}
    group_media = {r['meta']['source_group']: r['id'] for r in media_rows}
    orphan = [g for g in media_map if g['group'] not in seen_groups]
    if orphan:
        print('  !! converted groups without library item:', len(orphan))

    print('media_url_map')
    upsert('media_url_map', [{
        'old_path': p, 'new_url': u, 'media_id': group_media.get(g), 'variant': v}
        for p, (u, g, v) in variant_rows.items()], chunk=500)

    print('terms')
    term_rows = []
    for c in cats:
        term_rows.append({'id': c['id'], 'taxonomy': 'category', 'slug': c['slug'], 'name': htmllib.unescape(c['name']),
                          'description': c.get('description') or '', 'parent_id': c.get('parent') or None,
                          'count': c['count'], 'path': path_of(c['link']), 'meta': {'seo': seo_for(c['link'])}})
    for c in tags:
        term_rows.append({'id': c['id'], 'taxonomy': 'post_tag', 'slug': c['slug'], 'name': htmllib.unescape(c['name']),
                          'description': c.get('description') or '', 'count': c['count'],
                          'path': path_of(c['link']), 'meta': {'seo': seo_for(c['link'])}})
    for c in pcats:
        img = (scats.get(c['id']) or {}).get('image') or {}
        term_rows.append({'id': c['id'], 'taxonomy': 'product_cat', 'slug': c['slug'], 'name': htmllib.unescape(c['name']),
                          'description': rewrite(c.get('description') or ''), 'parent_id': c.get('parent') or None,
                          'count': c['count'], 'menu_order': c.get('menu_order') or 0,
                          'image_media_id': img.get('id') if img.get('id') in media_ids else None,
                          'path': path_of(c['link']), 'meta': {'seo': seo_for(c['link'])}})
    # parents first
    term_rows.sort(key=lambda r: (r.get('parent_id') is not None, r['id']))
    for r in term_rows:
        r.setdefault('parent_id', None)
        r.setdefault('menu_order', 0)
        r.setdefault('image_media_id', None)
    upsert('terms', term_rows)
    term_ids = {r['id'] for r in term_rows}

    print('posts / pages / navigation')
    post_rows, post_terms = [], []

    def base_post(p, ptype):
        return {
            'id': p['id'], 'post_type': ptype, 'slug': nfc(urllib.parse.unquote(p['slug'])),
            'path': path_of(p['link']), 'status': p['status'],
            'title': htmllib.unescape(p['title']['rendered']),
            'content_html': rewrite(p['content']['rendered']),
            'excerpt_html': rewrite((p.get('excerpt') or {}).get('rendered') or ''),
            'author_id': p.get('author') if p.get('author') in author_ids else None,
            'featured_media_id': p.get('featured_media') if p.get('featured_media') in media_ids else None,
            'parent_id': p.get('parent') or None, 'menu_order': p.get('menu_order') or 0,
            'comment_status': p.get('comment_status') or 'closed', 'ping_status': p.get('ping_status') or 'closed',
            'sticky': bool(p.get('sticky')), 'template': p.get('template') or '', 'format': p.get('format') or 'standard',
            'date': ts(p['date']), 'date_gmt': ts_gmt(p['date_gmt']),
            'modified': ts(p['modified']), 'modified_gmt': ts_gmt(p['modified_gmt']),
            'seo': seo_for(p['link']) if ptype != 'wp_navigation' else {},
            'meta': {'wp_meta': p.get('meta') or {}, 'blocksy_meta': p.get('blocksy_meta') or {},
                     'class_list': p.get('class_list') or [], 'guid': (p.get('guid') or {}).get('rendered'),
                     'old_link': p.get('link')}}
    for p in posts:
        post_rows.append(base_post(p, 'post'))
        for i, t in enumerate((p.get('categories') or []) + (p.get('tags') or [])):
            if t in term_ids:
                post_terms.append({'post_id': p['id'], 'term_id': t, 'term_order': i})
    for p in sorted(pages, key=lambda x: (x.get('parent') or 0) != 0):
        post_rows.append(base_post(p, 'page'))
    for p in navs:
        r = base_post(p, 'wp_navigation')
        r['path'] = None   # /navigation/ 404 on the old site; not a public route
        post_rows.append(r)
    for r in post_rows:
        if r['post_type'] == 'wp_navigation':
            r['seo'] = {}
    upsert('posts', post_rows, chunk=50)
    upsert('post_terms', post_terms)

    print('comments')
    upsert('comments', [{
        'id': c['id'], 'post_id': c['post'], 'parent_id': c.get('parent') or None,
        'author_name': c.get('author_name') or '', 'author_url': c.get('author_url') or None,
        'content_html': rewrite(c['content']['rendered']), 'status': 'approved',
        'date': ts(c['date'])} for c in comments]) if comments else print('  comments: 0 (none public on old site)')

    print('products')
    prod_rows, prod_terms, prod_imgs, prod_attrs = [], [], [], []

    def money(v):
        return None if v in (None, '') else float(v)
    for p in products:
        s = sprod[p['id']]
        pr = s['prices']
        rng = pr.get('price_range') or {}
        avail = (s.get('stock_availability') or {}).get('class') or ''
        stock_status = 'outofstock' if 'out-of-stock' in avail or not s['is_in_stock'] else (
            'onbackorder' if s.get('is_on_backorder') else 'instock')
        on_sale = bool(s.get('on_sale'))
        prod_rows.append({
            'id': p['id'], 'slug': nfc(urllib.parse.unquote(p['slug'])), 'path': path_of(p['link']),
            'name': htmllib.unescape(p['title']['rendered']), 'type': s['type'], 'status': p['status'],
            'description_html': rewrite(restore_embeds(s.get('description') or p['content']['rendered'], p['content']['rendered'])),
            'short_description_html': rewrite(s.get('short_description') or (p.get('excerpt') or {}).get('rendered') or ''),
            'sku': s.get('sku') or None, 'currency': pr.get('currency_code') or 'TWD',
            'regular_price': money(pr.get('regular_price')),
            'sale_price': money(pr.get('sale_price')) if on_sale else None,
            'price': money(pr.get('price')),
            'price_min': money(rng.get('min_amount')) if rng else money(pr.get('price')),
            'price_max': money(rng.get('max_amount')) if rng else money(pr.get('price')),
            'on_sale': on_sale,
            'tax_status': 'taxable' if 'taxable' in (p.get('class_list') or []) else 'none',
            'manage_stock': s.get('low_stock_remaining') is not None,
            'stock_quantity': s.get('low_stock_remaining'),
            'stock_status': stock_status, 'backorders': 'no',
            'sold_individually': bool(s.get('sold_individually')),
            'is_purchasable': bool(s.get('is_purchasable')),
            'weight': s.get('weight') or None, 'dimensions': s.get('dimensions') or {},
            'featured_media_id': p.get('featured_media') if p.get('featured_media') in media_ids else None,
            'menu_order': 0, 'date': ts(p['date']), 'date_gmt': ts_gmt(p['date_gmt']),
            'modified': ts(p['modified']), 'modified_gmt': ts_gmt(p['modified_gmt']),
            'seo': seo_for(p['link']),
            'meta': {'wp_meta': p.get('meta') or {}, 'class_list': p.get('class_list') or [],
                     'add_to_cart': rewrite_json(s.get('add_to_cart')), 'stock_availability': s.get('stock_availability'),
                     'old_link': p['link'], 'guid': (p.get('guid') or {}).get('rendered'),
                     'variation_ids': [v['id'] for v in s.get('variations') or []]}})
        for t in p.get('product_cat') or []:
            if t in term_ids:
                prod_terms.append({'product_id': p['id'], 'term_id': t})
        for t in p.get('product_tag') or []:
            if t in term_ids:
                prod_terms.append({'product_id': p['id'], 'term_id': t})
        seen = set()
        for i, im in enumerate(s.get('images') or []):
            if im['id'] in media_ids and im['id'] not in seen:
                seen.add(im['id'])
                prod_imgs.append({'product_id': p['id'], 'media_id': im['id'], 'position': i})
        for i, a in enumerate(s.get('attributes') or []):
            prod_attrs.append({'product_id': p['id'], 'attribute_id': None, 'name': a['name'], 'position': i,
                               'is_visible': True, 'is_variation': bool(a.get('has_variations')),
                               'options': [t['name'] for t in a.get('terms') or []]})
    upsert('products', prod_rows, chunk=40)
    upsert('product_terms', prod_terms)
    upsert('product_images', prod_imgs)
    rest('DELETE', 'product_attributes', query='?id=gt.0', prefer='return=minimal')
    upsert('product_attributes', prod_attrs)

    print('product_variations')
    var_rows, rules = [], []
    for pid, s in sprod.items():
        parent_img = (s.get('images') or [{}])[0].get('id')
        for order, ref in enumerate(s.get('variations') or []):
            d = svars[str(ref['id'])]['data']
            pr = d['prices']
            attrs = {a['name']: a['value'] for a in ref['attributes']}
            img = (d.get('images') or [{}])[0].get('id')
            on_sale = bool(d.get('on_sale'))
            avail = (d.get('stock_availability') or {}).get('class') or ''
            var_rows.append({
                'id': d['id'], 'product_id': pid, 'slug': nfc(urllib.parse.unquote(d.get('slug') or '')),
                'status': 'publish', 'attributes': attrs, 'label': (d.get('variation') or '').strip(),
                'description_html': rewrite(d.get('description') or ''), 'sku': d.get('sku') or None,
                'regular_price': money(pr.get('regular_price')),
                'sale_price': money(pr.get('sale_price')) if on_sale else None,
                'price': money(pr.get('price')), 'on_sale': on_sale,
                'manage_stock': d.get('low_stock_remaining') is not None,
                'stock_quantity': d.get('low_stock_remaining'),
                'stock_status': 'outofstock' if ('out-of-stock' in avail or not d.get('is_in_stock')) else 'instock',
                'is_purchasable': bool(d.get('is_purchasable')),
                'image_media_id': img if (img in media_ids and img != parent_img) else None,
                'menu_order': order,
                'meta': {'permalink': rewrite(d.get('permalink') or ''), 'add_to_cart': rewrite_json(d.get('add_to_cart'))}})
            # ---- discount rules parsed from the ticket label (早鳥 9 折 / 2 人 95 折 / 3 人 9 折 / NTxxx/人)
            label = ' '.join(attrs.values()).replace(' ', ' ')
            persons = None
            m = re.search(r'([1-9一二兩三四五])\s*人', label)
            if m:
                persons = {'一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5}.get(m.group(1)) or int(m.group(1))
            elif '單人' in label:
                persons = 1
            elif '雙人' in label:
                persons = 2
            for zm in re.finditer(r'(\d{1,2})\s*折', label):
                n = zm.group(1)
                off = 100 - (int(n) * 10 if len(n) == 1 else int(n))
                rules.append({'product_id': pid, 'variation_id': d['id'], 'label': label.strip(),
                              'min_qty': 1, 'persons': persons, 'discount_type': 'percent',
                              'discount_value': off, 'source': 'variation_label',
                              'priority': 1 if '再打' in label[:zm.start() + 4] else 0})
            fm = re.search(r'NT\$?\s*(\d+)\s*/\s*[人位]', label)
            if fm:
                rules.append({'product_id': pid, 'variation_id': d['id'], 'label': label.strip(),
                              'min_qty': 1, 'persons': persons, 'discount_type': 'fixed_price',
                              'discount_value': int(fm.group(1)), 'source': 'variation_label', 'priority': 0})
    upsert('product_variations', var_rows)
    rest('DELETE', 'quantity_discount_rules', query='?source=eq.variation_label', prefer='return=minimal')
    for r in rules:
        r.setdefault('priority', 0)
    upsert('quantity_discount_rules', rules)

    print('menus')
    upsert('menus', [
        {'id': 1, 'slug': 'main', 'name': '主選單', 'location': 'header',
         'meta': {'locations': ['header', 'offcanvas'], 'source': 'html:home.html (wp nav menus API 401)'}},
        {'id': 2, 'slug': 'footer-social', 'name': '頁尾社群連結', 'location': 'footer',
         'meta': {'source': 'html:home.html footer'}}])
    items = []
    obj_re = re.compile(r'menu-item-object-(\w+)')
    type_re = re.compile(r'menu-item-type-(\w+)')

    def walk(nodes, parent):
        for pos, n in enumerate(nodes):
            mid = int(re.search(r'menu-item-(\d+)', n['classes']).group(1))
            href = n['href']
            otype = (obj_re.search(n['classes']) or [None, None])[1]
            oid = None
            path = path_of(href) if re.match(OLD_HOST_RE, href) else None
            if path:
                for coll in (post_rows, prod_rows, term_rows):
                    hit = next((r['id'] for r in coll if r.get('path') == path), None)
                    if hit:
                        oid = hit
                        break
            items.append({'id': mid, 'menu_id': 1, 'parent_id': parent, 'position': pos,
                          'label': htmllib.unescape(n['label']), 'url': rewrite(href),
                          'object_type': otype, 'object_id': oid, 'target': None, 'classes': n['classes'],
                          'meta': {'type': (type_re.search(n['classes']) or [None, None])[1]}})
            walk(n['children'], mid)
    header = next(m for m in menus_html['menus'] if m['location'] == 'header')
    walk(header['items'], None)

    def cf_email(h):
        enc = h.split('#', 1)[1]
        k = int(enc[:2], 16)
        return 'mailto:' + ''.join(chr(int(enc[i:i + 2], 16) ^ k) for i in range(2, len(enc), 2))
    for pos, l in enumerate(menus_html['footer_links']):
        href = cf_email(l['h']) if 'email-protection#' in l['h'] else l['h']
        host = urllib.parse.urlsplit(href).netloc.replace('www.', '').split('.')[0] if '://' in href else 'email'
        items.append({'id': 900000 + pos, 'menu_id': 2, 'parent_id': None, 'position': pos,
                      'label': l['t'] or host, 'url': href, 'object_type': 'custom', 'object_id': None,
                      'target': '_blank' if '://' in href else None, 'classes': None, 'meta': {'icon': host}})
    upsert('menu_items', items)

    print('forms')
    form_rows, seen = [], set()
    for f in features['forms']:
        cls = f.get('cls') or ''
        kind = ('search' if 'search' in cls else 'variations' if 'variations_form' in cls else
                'comment' if f['id'] == 'commentform' else 'newsletter' if 'elementor-form' in cls else
                'login' if 'login' in (f['id'] + cls) else 'register' if 'register' in f['id'] else
                'lostpassword' if 'lostpassword' in f['id'] else 'contact')
        if kind == 'variations':
            continue  # add-to-cart forms are generated from product_variations
        slug = f['id'] or (cls.split()[0] if cls else kind)
        if 'woocommerce-form-login' in cls:
            slug = 'woocommerce-login'
        if slug in seen:
            continue
        seen.add(slug)
        source = ('elementor' if 'elementor' in cls else 'woocommerce' if 'woocommerce' in cls else
                  'blocksy' if slug in ('loginform', 'registerform', 'lostpasswordform') or 'ct-' in cls else 'wp')
        form_rows.append({'slug': slug, 'name': {'search': '站內搜尋', 'login': '登入', 'register': '註冊',
                                                 'lostpassword': '忘記密碼', 'comment': '留言',
                                                 'newsletter': '電子報訂閱'}.get(kind, slug),
                          'source': source, 'form_type': kind,
                          'action': path_of(f['action']) if f.get('action') and '://' in f['action'] else f.get('action'),
                          'method': f.get('method') or 'post',
                          'fields': [x for x in f['fields'] if x.get('type') != 'hidden' or x.get('name') == 'form_id'],
                          'settings': {'role': f.get('role'), 'class': cls, 'page_count': f.get('page_count')},
                          'pages': sorted({path_of(p) for p in f.get('pages') or []}), 'status': 'published'})
    rest('POST', 'forms', form_rows, query='?on_conflict=slug')
    print(f'  forms: {len(form_rows)}')

    print('settings')
    cf = features.get('commerce', {})
    settings = {
        'site.title': (root['name'], True), 'site.tagline': (root['description'], True),
        'site.legacy_url': ('https://dayinup.com', False), 'site.language': ('zh-TW', True),
        'site.timezone': ('Asia/Taipei', True), 'site.gmt_offset': (8, True),
        'site.logo_media_id': (root.get('site_logo'), True), 'site.icon_media_id': (root.get('site_icon'), True),
        'site.icon_url': (rewrite(root.get('site_icon_url')), True),
        'reading.show_on_front': ('page', True), 'reading.page_on_front': (12661, True),
        'reading.posts_per_page': (10, True),
        'permalinks.structure': ('/%postname%/', True), 'permalinks.category_base': ('category', True),
        'permalinks.tag_base': ('tag', True), 'permalinks.product_base': ('product', True),
        'permalinks.product_category_base': ('product-category', True),
        'theme': (load('manifest.json')['wp'], True),
        'footer.copyright': (menus_html.get('footer_text', '').strip(), True),
        'woocommerce.currency': (wc.get('currency'), True),
        'woocommerce.coupons_enabled': (wc.get('couponsEnabled'), True),
        'woocommerce.taxes_enabled': (wc.get('taxesEnabled'), True),
        'woocommerce.shipping_enabled': (wc.get('shippingEnabled'), True),
        'woocommerce.prices_include_tax': (wc.get('displayCartPricesIncludingTax'), True),
        'woocommerce.checkout_fields': (wc.get('defaultFields'), True),
        'woocommerce.address_fields_locations': (wc.get('addressFieldsLocations'), True),
        'woocommerce.store_pages': (rewrite_json(cf.get('store_pages')), True),
        'woocommerce.payment_methods': ({'old_site': cf.get('payment_methods'), 'note': cf.get('payment_note'),
                                         'new_site': 'pending-only (no live gateway)'}, False),
        'membership.register_pages': (features.get('membership', {}).get('register_pages'), True),
        'tracking': ({'items': rewrite_json(features.get('tracking')), 'note': 'IDs observed on old site; not auto-enabled'}, False),
        'embeds': (features.get('embeds'), True),
    }
    upsert('settings', [{'key': k, 'value': v, 'is_public': pub} for k, (v, pub) in settings.items()])

    print('redirects / legacy_urls')
    redirects = {}
    for r in media_rows:
        if r['attachment_path'] and r['attachment_path'] != '/':
            redirects[r['attachment_path']] = (r['public_url'], 'attachment')
        redirects[f"/?attachment_id={r['id']}"] = (r['public_url'], 'attachment')
    for r in post_rows + prod_rows:
        redirects[f"/?p={r['id']}"] = (r.get('path') or '/', 'legacy')
    for r in post_rows:
        if r['post_type'] == 'page' and r['path']:
            redirects[f"/?page_id={r['id']}"] = (r['path'], 'legacy')
    rest('DELETE', 'redirects', query='?kind=in.(attachment,legacy)', prefer='return=minimal')
    upsert('redirects', [{'source_path': k, 'target': v, 'status_code': 301, 'kind': kind}
                         for k, (v, kind) in redirects.items() if k != v], chunk=500)

    by_path = {}
    for r in post_rows:
        if r['path']:
            by_path[r['path']] = (r['post_type'], r['id'])
    for r in prod_rows:
        by_path[r['path']] = ('product', r['id'])
    for r in term_rows:
        by_path[r['path']] = (r['taxonomy'], r['id'])
    for u in users:
        by_path[path_of(u['link'])] = ('author', u['id'])
    legacy = []
    for u in urls:
        p = path_of(u['url'])
        kind, oid = by_path.get(p, ('other', None))
        legacy.append({'path': p, 'kind': kind, 'object_id': oid, 'sources': u.get('sources') or [],
                       'lastmod': u.get('lastmod')})
    upsert('legacy_urls', legacy)

    print('unresolved upload urls:', len(unresolved))
    for u in sorted(unresolved)[:20]:
        print('   ', u)


main()
