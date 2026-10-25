#!/usr/bin/env python3
"""Import DayinUP *private* WordPress/WooCommerce data into Supabase schema site_dayinup.

usage: python3 -I import-private.py <tablesDir> [--reconcile-only]
       tablesDir = directory with one <wp_table>.jsonl per WordPress table (+ _index.json)
env:   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (never printed)

The dump contains personal data. This script only reads it and writes it to the private
tables via PostgREST (service role). It prints COUNTS AND TOTALS ONLY — never names, e-mails,
phones, addresses or IPs. Nothing from the dump is written to disk.

Source of truth for orders: legacy posts (`shop_order` / `shop_order_refund` + postmeta), because
woocommerce_custom_orders_table_enabled = no on the old site (HPOS tables were a sync copy).
Both sources carry the same IDs, so they are merged by ID (dedupe); HPOS fills structured fields
(addresses, operational data) and legacy wins on any conflict (e.g. a refund trashed in legacy).

Idempotent: upserts on the original WordPress IDs.
  customers.id   = WP user ID (registered) | 100000 + wc_customer_lookup.customer_id (guests)
  orders.id      = WP order ID;   order_items.id = order_item_id;   order_notes.id = comment ID
  coupons.id     = WP shop_coupon ID;   comments.id = comment ID;   menus.id = nav_menu term_id
  forms.id       = Fluent Forms form ID (1..n);  form_submissions.id = 200000+Elementor id | 300000+Fluent id
"""
import collections
import json
import os
import re
import sys
import urllib.parse
import urllib.request

TABLES = sys.argv[1]
RECONCILE_ONLY = '--reconcile-only' in sys.argv
SB_URL = os.environ['SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
SCHEMA = 'site_dayinup'
GUEST_BASE = 100000
ELEMENTOR_SUB_BASE = 200000
FLUENT_SUB_BASE = 300000
ELEMENTOR_FORM_ID = 1000005  # existing "elementor-form" (Email 收集 / 電子報) row


# ------------------------------------------------------------------ io helpers
def load(name):
    p = os.path.join(TABLES, name + '.jsonl')
    if not os.path.exists(p):
        return []
    with open(p, encoding='utf-8') as f:
        return [json.loads(l) for l in f if l.strip()]


def rest(method, table, rows=None, query='', prefer='resolution=merge-duplicates,return=minimal'):
    url = f'{SB_URL}/rest/v1/{table}{query}'
    data = json.dumps(rows, ensure_ascii=False, default=str).encode() if rows is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json',
        'Content-Profile': SCHEMA, 'Accept-Profile': SCHEMA, 'Prefer': prefer,
        'User-Agent': 'GatherMigrator/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        # error bodies can echo row values -> print status + PostgREST code/message only
        try:
            err = json.loads(e.read())
            msg = f"{err.get('code')} {str(err.get('message'))[:160]}"
        except Exception:
            msg = '(unparsable error body)'
        raise SystemExit(f'{method} {table} failed {e.code}: {msg}')


def select_all(table, cols, query=''):
    out, off = [], 0
    while True:
        sep = '&' if query else ''
        page = rest('GET', table, query=f'?select={cols}{sep}{query}&limit=1000&offset={off}', prefer='')
        out += page or []
        if not page or len(page) < 1000:
            return out
        off += 1000


def upsert(table, rows, chunk=200):
    # PostgREST bulk upsert needs identical key sets per request
    by_keys = collections.defaultdict(list)
    for r in rows:
        by_keys[tuple(sorted(r))].append(r)
    for group in by_keys.values():
        for i in range(0, len(group), chunk):
            rest('POST', table, group[i:i + chunk])
    print(f'  upsert {table}: {len(rows)}')


# ------------------------------------------------------------------ value helpers
def php_unserialize(s):
    """Minimal PHP unserialize (a, s, i, d, b, N). Returns s unchanged if not serialized."""
    if not isinstance(s, str) or not re.match(r'^(a|s|i|d|b|N)[:;]', s):
        return s
    b = s.encode('utf-8')
    pos = 0

    def read_until(ch):
        nonlocal pos
        end = b.index(ch, pos)
        v = b[pos:end].decode()
        pos = end + 1
        return v

    def parse():
        nonlocal pos
        t = chr(b[pos]); pos += 2
        if t == 'N':
            return None
        if t == 'b':
            return read_until(b';') == '1'
        if t == 'i':
            return int(read_until(b';'))
        if t == 'd':
            return float(read_until(b';'))
        if t == 's':
            n = int(read_until(b':'))
            pos += 1
            v = b[pos:pos + n].decode('utf-8', 'replace')
            pos += n + 2
            return v
        if t == 'a':
            n = int(read_until(b':'))
            pos += 1
            d = {}
            for _ in range(n):
                k = parse(); v = parse(); d[k] = v
            pos += 1
            if list(d.keys()) == list(range(len(d))):
                return list(d.values())
            return d
        raise ValueError('unsupported php type ' + t)

    try:
        return parse()
    except Exception:
        return s


def num(v, default=0.0):
    try:
        return round(float(v), 2) if v not in (None, '') else default
    except (TypeError, ValueError):
        return default


def gmt(v):
    if not v or str(v).startswith('0000'):
        return None
    v = str(v)
    return v.replace(' ', 'T') + 'Z' if len(v) == 19 else v


def ids_list(v):
    if v in (None, ''):
        return []
    v = php_unserialize(v)
    if isinstance(v, list):
        return [int(x) for x in v if str(x).strip().isdigit()]
    return [int(x) for x in str(v).split(',') if x.strip().isdigit()]


def clean(d):
    return {k: v for k, v in d.items() if v not in (None, '', [], {})}


def lower(e):
    return (e or '').strip().lower() or None


ADDR_KEYS = ['first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'email', 'phone']

# ------------------------------------------------------------------ load source
src = {t: load(t) for t in [
    'wp_posts', 'wp_postmeta', 'wp_users', 'wp_usermeta', 'wp_comments', 'wp_terms', 'wp_term_taxonomy',
    'wp_term_relationships', 'wp_wc_orders', 'wp_wc_order_addresses', 'wp_wc_orders_meta',
    'wp_wc_order_operational_data', 'wp_wc_order_stats', 'wp_wc_customer_lookup',
    'wp_woocommerce_order_items', 'wp_woocommerce_order_itemmeta', 'wp_e_submissions',
    'wp_e_submissions_values', 'wp_fluentform_forms', 'wp_fluentform_form_meta', 'wp_fluentform_submissions',
    'wp_fluentform_submission_meta', 'wp_fluentform_order_items', 'wp_options',
    'wp_woocommerce_shipping_zones', 'wp_woocommerce_shipping_zone_methods',
    'wp_woocommerce_shipping_zone_locations', 'wp_wc_tax_rate_classes']}
posts = {r['ID']: r for r in src['wp_posts']}
postmeta = collections.defaultdict(dict)
for r in src['wp_postmeta']:
    postmeta[r['post_id']][r['meta_key']] = r['meta_value']
options = {r['option_name']: r['option_value'] for r in src['wp_options']}

# ------------------------------------------------------------------ existing public rows (for FKs / URLs)
db_posts = {r['id']: r for r in select_all('posts', 'id,post_type,path,title,status')}
db_terms = {r['id']: r for r in select_all('terms', 'id,taxonomy,name,path')}
db_products = {r['id'] for r in select_all('products', 'id')}
db_variations = {r['id'] for r in select_all('product_variations', 'id')}

# ================================================================== customers
umeta = collections.defaultdict(dict)
for r in src['wp_usermeta']:
    umeta[r['user_id']][r['meta_key']] = r['meta_value']

lookup = {r['customer_id']: r for r in src['wp_wc_customer_lookup']}
lookup_by_user = {r['user_id']: r for r in lookup.values() if r['user_id']}


def lookup_customer_id(lid):
    lr = lookup.get(lid)
    if not lr:
        return None
    cid = lr['user_id'] if lr['user_id'] else GUEST_BASE + lid
    return guest_alias.get(cid, cid)


guest_alias = {}   # guest customers.id -> registered customers.id (same e-mail), filled below


customers = {}
for u in src['wp_users']:
    m = umeta[u['ID']]
    caps = php_unserialize(m.get('wp_capabilities') or '')
    role = next(iter(caps), 'customer') if isinstance(caps, dict) and caps else 'customer'
    lr = lookup_by_user.get(u['ID'])
    customers[u['ID']] = {
        'id': u['ID'],
        'email': lower(u['user_email']),
        'username': u['user_login'],
        'first_name': m.get('first_name') or None,
        'last_name': m.get('last_name') or None,
        'display_name': u['display_name'] or None,
        'role': role,
        'billing': clean({k: m.get('billing_' + k) for k in ADDR_KEYS}),
        'shipping': clean({k: m.get('shipping_' + k) for k in ADDR_KEYS}),
        'is_paying_customer': m.get('paying_customer') == '1',
        'date_created': gmt(u['user_registered']),
        'date_modified': gmt(lr['date_last_active']) if lr and lr.get('date_last_active') else None,
        'meta': clean({'source': 'wp_users', 'wp_user_id': u['ID'],
                       'wc_customer_lookup_id': lr['customer_id'] if lr else None,
                       'wp_role_raw': list(caps) if isinstance(caps, dict) else None}),
    }
for lid, lr in lookup.items():
    if lr['user_id']:
        continue
    customers[GUEST_BASE + lid] = {
        'id': GUEST_BASE + lid,
        'email': lower(lr['email']),
        'username': None,
        'first_name': lr['first_name'] or None,
        'last_name': lr['last_name'] or None,
        'display_name': ' '.join(x for x in [lr['last_name'], lr['first_name']] if x) or None,
        'role': 'guest',
        'billing': clean({'first_name': lr['first_name'], 'last_name': lr['last_name'], 'email': lr['email'],
                          'phone': lr.get('billing_phone'), 'country': lr.get('country'), 'postcode': lr.get('postcode'),
                          'city': lr.get('city'), 'state': lr.get('state')}),
        'shipping': clean({'phone': lr.get('shipping_phone')}),
        'is_paying_customer': False,
        'date_created': gmt(lr['date_registered']) or gmt(lr['date_last_active']),
        'date_modified': gmt(lr['date_last_active']),
        'meta': {'source': 'wc_customer_lookup', 'wc_customer_lookup_id': lid},
    }

# Same e-mail as a registered WP user → one customer (WooCommerce also treats them as one person):
# the guest lookup row is folded into the wp_users row (orders re-pointed via guest_alias).
reg_by_email = {c['email']: cid for cid, c in customers.items() if cid < GUEST_BASE and c['email']}
for cid in [c for c in customers if c >= GUEST_BASE]:
    g = customers[cid]
    rid = reg_by_email.get(g['email'])
    if not rid:
        continue
    r = customers[rid]
    for k in ('first_name', 'last_name'):
        r[k] = r[k] or g[k]
    r['billing'] = r['billing'] or g['billing']
    r['shipping'] = r['shipping'] or g['shipping']
    r['meta'] = {**r['meta'], 'merged_guest_ids': r['meta'].get('merged_guest_ids', []) + [cid],
                 'merged_wc_customer_lookup_ids': r['meta'].get('merged_wc_customer_lookup_ids', []) + [g['meta']['wc_customer_lookup_id']]}
    guest_alias[cid] = rid
    del customers[cid]

# ================================================================== orders (dedupe legacy + HPOS by ID)
hpos = {r['id']: r for r in src['wp_wc_orders']}
legacy = {i: p for i, p in posts.items() if p['post_type'] in ('shop_order', 'shop_order_refund')}
addr = collections.defaultdict(dict)
for r in src['wp_wc_order_addresses']:
    addr[r['order_id']][r['address_type']] = clean({k: r.get(k) for k in ADDR_KEYS})
opdata = {r['order_id']: r for r in src['wp_wc_order_operational_data']}
hmeta = collections.defaultdict(dict)
for r in src['wp_wc_orders_meta']:
    hmeta[r['order_id']][r['meta_key']] = r['meta_value']
stats = {r['order_id']: r for r in src['wp_wc_order_stats']}

items_by_order = collections.defaultdict(list)
for r in src['wp_woocommerce_order_items']:
    items_by_order[r['order_id']].append(r)
itemmeta = collections.defaultdict(dict)
for r in src['wp_woocommerce_order_itemmeta']:
    k = urllib.parse.unquote(r['meta_key'])
    itemmeta[r['order_item_id']][k] = r['meta_value']

all_order_ids = sorted(set(hpos) | set(legacy))
dedupe = {'legacy': len(legacy), 'hpos': len(hpos), 'both': len(set(hpos) & set(legacy)), 'union': len(all_order_ids)}
KEEP_META = ['_newebpay_MerchantOrderNo', '_newebpay_payment_type', '_ezpay_invoice_number', '_ezpay_invoice_result',
             '_ezpay_invoice_data', '_refund_amount', '_refund_reason', '_refunded_by', '_refunded_payment',
             '_billing_full-address', 'is_vat_exempt', '_recorded_sales', '_recorded_coupon_usage_counts',
             '_order_stock_reduced', '_download_permissions_granted', '_new_order_email_sent', '_order_version']

orders, order_items = [], []
conflicts = collections.Counter()
for oid in all_order_ids:
    p, h = legacy.get(oid), hpos.get(oid)
    pm = {**hmeta.get(oid, {}), **postmeta.get(oid, {})}       # legacy postmeta wins
    od = opdata.get(oid, {})
    otype = p['post_type'] if p else h['type']
    status = (p['post_status'] if p else h['status'])
    if p and h and p['post_status'] != h['status']:
        conflicts['status'] += 1
    status = status[3:] if status.startswith('wc-') else status
    total = num(pm.get('_order_total')) if p else num(h['total_amount'])
    if h and abs(total - num(h['total_amount'])) > 0.001:
        conflicts['total'] += 1
    parent = (p['post_parent'] if p else h['parent_order_id']) or None
    meta = clean({k.lstrip('_'): pm.get(k) for k in KEEP_META})
    if parent and parent not in legacy and parent not in hpos:
        meta['wp_parent_order_id'] = parent
        parent = None
    cust_user = int(pm.get('_customer_user') or (h['customer_id'] if h else 0) or 0)
    if cust_user and cust_user in customers:
        customer_id = cust_user
    else:
        customer_id = lookup_customer_id(stats.get(oid, {}).get('customer_id')) if otype == 'shop_order' else None
    billing = addr.get(oid, {}).get('billing') or clean({k: pm.get('_billing_' + k) for k in ADDR_KEYS})
    shipping = addr.get(oid, {}).get('shipping') or clean({k: pm.get('_shipping_' + k) for k in ADDR_KEYS})
    attribution = clean({k[len('_wc_order_attribution_'):]: v for k, v in pm.items() if k.startswith('_wc_order_attribution_')})
    lines = items_by_order.get(oid, [])
    coupon_codes = [it['order_item_name'] for it in lines if it['order_item_type'] == 'coupon']
    subtotal = sum(num(itemmeta[it['order_item_id']].get('_line_subtotal')) for it in lines if it['order_item_type'] == 'line_item')
    row = {
        'id': oid,
        'order_key': od.get('order_key') or pm.get('_order_key') or f'wc_order_import_{oid}',
        'parent_id': parent,
        'type': otype,
        'status': status,
        'currency': pm.get('_order_currency') or (h['currency'] if h else 'TWD'),
        'customer_id': customer_id,
        'billing_email': lower(billing.get('email') or pm.get('_billing_email') or (h['billing_email'] if h else None)),
        'billing': billing,
        'shipping': shipping,
        'payment_method': pm.get('_payment_method') or (h['payment_method'] if h else None) or None,
        'payment_method_title': pm.get('_payment_method_title') or (h['payment_method_title'] if h else None) or None,
        'transaction_id': pm.get('_transaction_id') or (h['transaction_id'] if h else None) or None,
        'customer_note': (p['post_excerpt'] if p else None) or (h['customer_note'] if h else None) or None,
        'prices_include_tax': pm.get('_prices_include_tax') == 'yes',
        'subtotal': round(subtotal, 2),
        'discount_total': num(pm.get('_cart_discount', od.get('discount_total_amount'))),
        'discount_tax': num(pm.get('_cart_discount_tax', od.get('discount_tax_amount'))),
        'shipping_total': num(pm.get('_order_shipping', od.get('shipping_total_amount'))),
        'shipping_tax': num(pm.get('_order_shipping_tax', od.get('shipping_tax_amount'))),
        'cart_tax': num(pm.get('_order_tax', h['tax_amount'] if h else 0)),
        'total_tax': round(num(pm.get('_order_tax')) + num(pm.get('_order_shipping_tax')), 2),
        'total': total,
        'coupon_codes': coupon_codes,
        'customer_ip': pm.get('_customer_ip_address') or (h['ip_address'] if h else None) or None,
        'customer_user_agent': pm.get('_customer_user_agent') or (h['user_agent'] if h else None) or None,
        'created_via': od.get('created_via') or pm.get('_created_via') or ('refund' if otype == 'shop_order_refund' else 'checkout'),
        'attribution': attribution,
        'date_created': gmt(p['post_date_gmt'] if p else h['date_created_gmt']),
        'date_modified': gmt(p['post_modified_gmt'] if p else h['date_updated_gmt']),
        'date_paid': gmt(od.get('date_paid_gmt')) or (gmt(pm.get('_paid_date')) if pm.get('_paid_date') else None),
        'date_completed': gmt(od.get('date_completed_gmt')) or (gmt(pm.get('_completed_date')) if pm.get('_completed_date') else None),
        'meta': {**meta, 'source': 'wordpress', 'wp_order_id': oid},
    }
    orders.append(row)
    for it in lines:
        m = itemmeta[it['order_item_id']]
        variation = {k: v for k, v in m.items() if not k.startswith('_') and k not in ('discount_amount', 'discount_amount_tax', 'coupon_info')}
        pid = int(m.get('_product_id') or 0) or None
        vid = int(m.get('_variation_id') or 0) or None
        imeta = clean({k.lstrip('_'): m.get(k) for k in ('_tax_class', '_line_tax_data', '_reduced_stock', '_refunded_item_id',
                                                         '_restock_refunded_items', 'coupon_info', 'discount_amount_tax')})
        if pid and pid not in db_products:
            imeta['wp_product_id'] = pid; pid = None
        if vid and vid not in db_variations:
            imeta['wp_variation_id'] = vid; vid = None
        if it['order_item_type'] == 'coupon':
            sub = tot = -num(m.get('discount_amount'))
            stax = ttax = -num(m.get('discount_amount_tax'))
        else:
            sub, stax = num(m.get('_line_subtotal')), num(m.get('_line_subtotal_tax'))
            tot, ttax = num(m.get('_line_total')), num(m.get('_line_tax'))
        order_items.append({
            'id': it['order_item_id'], 'order_id': oid, 'item_type': it['order_item_type'], 'name': it['order_item_name'] or '',
            'product_id': pid, 'variation_id': vid, 'quantity': int(float(m.get('_qty') or 1)),
            'subtotal': sub, 'subtotal_tax': stax, 'total': tot, 'total_tax': ttax,
            'variation': variation, 'meta': imeta,
        })

# customer aggregates (WooCommerce: paid statuses processing/completed, refunds subtracted)
refund_sum = collections.defaultdict(float)
for o in orders:
    if o['type'] == 'shop_order_refund' and o['parent_id'] and o['status'] != 'trash':
        refund_sum[o['parent_id']] += o['total']
agg = collections.defaultdict(lambda: [0, 0.0])
for o in orders:
    if o['type'] == 'shop_order' and o['customer_id'] and o['status'] != 'trash':
        agg[o['customer_id']][0] += 1
        if o['status'] in ('processing', 'completed', 'refunded'):
            agg[o['customer_id']][1] += o['total'] + refund_sum.get(o['id'], 0)
for cid, c in customers.items():
    n, spent = agg.get(cid, (0, 0.0))
    c['orders_count'] = n
    c['total_spent'] = round(spent, 2)
    c['is_paying_customer'] = c['is_paying_customer'] or spent > 0

# ================================================================== order notes
notes = []
for r in src['wp_comments']:
    if r['comment_type'] != 'order_note':
        continue
    notes.append({'id': r['comment_ID'], 'order_id': r['comment_post_ID'], 'note': r['comment_content'] or '',
                  'is_customer_note': False, 'added_by': r['comment_author'] or None,
                  'created_at': gmt(r['comment_date_gmt']) or gmt(r['comment_date'])})

# ================================================================== comments (blog)
CSTATUS = {'1': 'approved', '0': 'hold', 'spam': 'spam', 'trash': 'trash', 'post-trashed': 'trash'}
comments, skipped_comments = [], 0
blog_comments = [r for r in src['wp_comments'] if r['comment_type'] != 'order_note']
cids = {r['comment_ID'] for r in blog_comments}
for r in blog_comments:
    if r['comment_post_ID'] not in db_posts:
        skipped_comments += 1
        continue
    comments.append({
        'id': r['comment_ID'], 'post_id': r['comment_post_ID'],
        'parent_id': r['comment_parent'] if r['comment_parent'] in cids else None,
        'author_name': r['comment_author'] or '', 'author_email': lower(r['comment_author_email']),
        'author_url': r['comment_author_url'] or None, 'author_user_id': r['user_id'] or None,
        'author_ip': r['comment_author_IP'] or None, 'user_agent': r['comment_agent'] or None,
        'content_html': r['comment_content'] or '', 'status': CSTATUS.get(str(r['comment_approved']), 'hold'),
        'comment_type': r['comment_type'] or 'comment', 'date': gmt(r['comment_date_gmt']) or gmt(r['comment_date']),
        'meta': {'source': 'wordpress'},
    })

# ================================================================== coupons
coupons = []
for p in posts.values():
    if p['post_type'] != 'shop_coupon':
        continue
    m = postmeta[p['ID']]

    def lim(k):
        v = int(m.get(k) or 0)
        return v or None
    exp = m.get('date_expires')
    coupons.append({
        'id': p['ID'], 'code': p['post_title'], 'status': p['post_status'], 'description': p['post_excerpt'] or '',
        'discount_type': m.get('discount_type') or 'fixed_cart', 'amount': num(m.get('coupon_amount')),
        'date_expires': (gmt(__import__('datetime').datetime.utcfromtimestamp(int(exp)).strftime('%Y-%m-%d %H:%M:%S')) if exp and str(exp).isdigit() else None),
        'usage_count': int(m.get('usage_count') or 0), 'usage_limit': lim('usage_limit'),
        'usage_limit_per_user': lim('usage_limit_per_user'), 'limit_usage_to_x_items': lim('limit_usage_to_x_items'),
        'individual_use': m.get('individual_use') == 'yes', 'free_shipping': m.get('free_shipping') == 'yes',
        'exclude_sale_items': m.get('exclude_sale_items') == 'yes',
        'product_ids': ids_list(m.get('product_ids')), 'excluded_product_ids': ids_list(m.get('exclude_product_ids')),
        'product_category_ids': ids_list(m.get('product_categories')),
        'excluded_product_category_ids': ids_list(m.get('exclude_product_categories')),
        'minimum_amount': num(m.get('minimum_amount'), None), 'maximum_amount': num(m.get('maximum_amount'), None),
        'email_restrictions': [str(x) for x in (php_unserialize(m.get('customer_email')) or [])] if m.get('customer_email') else [],
        'used_by': [str(r['meta_value']) for r in src['wp_postmeta'] if r['post_id'] == p['ID'] and r['meta_key'] == '_used_by'],
        'date_created': gmt(p['post_date_gmt']), 'date_modified': gmt(p['post_modified_gmt']),
        'meta': {'source': 'wordpress'},
    })

# ================================================================== menus (nav_menu terms + nav_menu_item posts)
terms = {r['term_id']: r for r in src['wp_terms']}
tt = {r['term_taxonomy_id']: r for r in src['wp_term_taxonomy']}
nav_menus = {r['term_id']: r for r in tt.values() if r['taxonomy'] == 'nav_menu'}
item_menu = {}
for r in src['wp_term_relationships']:
    t = tt.get(r['term_taxonomy_id'])
    if t and t['taxonomy'] == 'nav_menu':
        item_menu[r['object_id']] = t['term_id']
locations = (php_unserialize(options.get('theme_mods_blocksy', '')) or {}).get('nav_menu_locations') or {}
menus, menu_items = [], []
for mid, t in nav_menus.items():
    slug = terms[mid]['slug']
    loc = next((k for k, v in locations.items() if v == mid), None)
    menus.append({'id': mid, 'slug': slug, 'name': terms[mid]['name'],
                  'location': 'header' if slug == 'main' else (loc or None),
                  'meta': clean({'source': 'wordpress', 'wp_term_id': mid, 'wp_location': loc})})
nav_items = [p for p in posts.values() if p['post_type'] == 'nav_menu_item' and p['ID'] in item_menu]
child_of = collections.Counter(int(postmeta[p['ID']].get('_menu_item_menu_item_parent') or 0) for p in nav_items)
for p in nav_items:
    m = postmeta[p['ID']]
    typ, obj = m.get('_menu_item_type'), m.get('_menu_item_object')
    oid = int(m.get('_menu_item_object_id') or 0) or None
    label, url = p['post_title'], m.get('_menu_item_url') or ''
    if typ == 'taxonomy' and oid in db_terms:
        label = label or db_terms[oid]['name']; url = db_terms[oid]['path'] or url
    elif typ == 'post_type' and oid in db_posts:
        label = label or db_posts[oid]['title']; url = db_posts[oid]['path'] or url
    elif typ == 'post_type' and oid in posts:
        label = label or posts[oid]['post_title']
    parent = int(m.get('_menu_item_menu_item_parent') or 0) or None
    classes = [c for c in (php_unserialize(m.get('_menu_item_classes')) or []) if c]
    has_kids = child_of.get(p['ID'], 0) > 0 and any(
        q['post_status'] == 'publish' for q in nav_items if int(postmeta[q['ID']].get('_menu_item_menu_item_parent') or 0) == p['ID'])
    cls = ['menu-item', f'menu-item-type-{typ}', f'menu-item-object-{obj}'] + (['menu-item-has-children'] if has_kids else []) \
        + [f'menu-item-{p["ID"]}'] + classes + (['animated-submenu-block'] if has_kids and not parent else [])
    menu_items.append({
        'id': p['ID'], 'menu_id': item_menu[p['ID']], 'parent_id': parent, 'position': p['menu_order'],
        'label': label or '', 'url': url or '#', 'object_type': obj if typ != 'custom' else 'custom', 'object_id': oid,
        'target': m.get('_menu_item_target') or None, 'classes': ' '.join(cls),
        'status': 'publish' if p['post_status'] == 'publish' else 'draft',
        'meta': clean({'type': typ, 'source': 'wordpress', 'xfn': m.get('_menu_item_xfn'),
                       'attr_title': p['post_excerpt'], 'description': p['post_content']}),
    })
# parents must be inserted before children
menu_items.sort(key=lambda r: (r['parent_id'] is not None, r['position']))

# ================================================================== forms + submissions
forms, submissions = [], []
fmeta = collections.defaultdict(dict)
for r in src['wp_fluentform_form_meta']:
    fmeta[r['form_id']][r['meta_key']] = r['value'] if 'value' in r else r.get('meta_value')
for f in src['wp_fluentform_forms']:
    try:
        ff = json.loads(f['form_fields'] or '{}')
    except ValueError:
        ff = {}
    fields = []
    for fld in ff.get('fields', []):
        attrs = fld.get('attributes') if isinstance(fld.get('attributes'), dict) else {}
        st = fld.get('settings') if isinstance(fld.get('settings'), dict) else {}
        vr = st.get('validation_rules') if isinstance(st.get('validation_rules'), dict) else {}
        fields.append(clean({'name': attrs.get('name'), 'type': attrs.get('type') or fld.get('element'),
                             'element': fld.get('element'), 'label': st.get('label'),
                             'placeholder': attrs.get('placeholder'),
                             'required': bool((vr.get('required') or {}).get('value')) if isinstance(vr.get('required'), dict) else False}))
    forms.append({'id': f['id'], 'slug': f'fluentform-{f["id"]}', 'name': f['title'], 'source': 'fluentform',
                  'form_type': 'contact', 'status': 'published' if f['status'] == 'published' else 'draft',
                  'fields': fields, 'settings': clean({'wp_form_id': f['id'], 'type': f.get('type'), 'has_payment': f.get('has_payment'),
                                                       'template_name': fmeta[f['id']].get('template_name')}),
                  'created_at': gmt(f['created_at'])})
sub_meta = collections.defaultdict(dict)
for r in src['wp_fluentform_submission_meta']:
    sub_meta[r['response_id']][r['meta_key']] = r['value']
sub_items = collections.defaultdict(list)
for r in src['wp_fluentform_order_items']:
    sub_items[r['submission_id']].append({k: r[k] for k in ('type', 'item_name', 'quantity', 'item_price', 'line_total')})
FSTATUS = {'unread': 'unread', 'read': 'read', 'spam': 'spam', 'trashed': 'trash', 'trash': 'trash'}
for s in src['wp_fluentform_submissions']:
    try:
        resp = json.loads(s['response'] or '{}')
    except ValueError:
        resp = {}
    data = {k: v for k, v in resp.items() if not k.startswith('_') and not k.startswith('__')}
    submissions.append({
        'id': FLUENT_SUB_BASE + s['id'], 'form_id': s['form_id'], 'data': data,
        'status': FSTATUS.get(s['status'], 'unread'), 'source_url': s['source_url'] or None, 'ip': s['ip'] or None,
        'user_agent': s['browser'] or None, 'customer_id': s['user_id'] if s['user_id'] in customers else None,
        'created_at': gmt(s['created_at']),
        'meta': clean({'source': 'fluentform', 'wp_id': s['id'], 'serial_number': s['serial_number'], 'device': s['device'],
                       'payment_status': s['payment_status'], 'payment_method': s['payment_method'],
                       'payment_total': s['payment_total'], 'currency': s['currency'],
                       'order_items': sub_items.get(s['id']), 'submission_meta': sub_meta.get(s['id']) or None}),
    })
e_vals = collections.defaultdict(dict)
for r in src['wp_e_submissions_values']:
    e_vals[r['submission_id']][r['key']] = r['value']
for s in src['wp_e_submissions']:
    submissions.append({
        'id': ELEMENTOR_SUB_BASE + s['id'], 'form_id': ELEMENTOR_FORM_ID, 'data': e_vals.get(s['id'], {}),
        'status': 'read' if s['is_read'] else ('trash' if s['status'] == 'trash' else 'unread'),
        'source_url': s['referer'] or None, 'ip': s['user_ip'] or None, 'user_agent': s['user_agent'] or None,
        'customer_id': s['user_id'] if s['user_id'] in customers else None,
        'created_at': gmt(s['created_at_gmt']),
        'meta': clean({'source': 'elementor', 'wp_id': s['id'], 'form_name': s['form_name'], 'element_id': s['element_id'],
                       'post_id': s['post_id'], 'referer_title': s['referer_title'], 'wp_status': s['status']}),
    })

# ================================================================== storefront-relevant settings (no secrets)
SECRET_RE = re.compile(r'key|secret|token|pass|hash|iv$|merchant', re.I)


def no_secrets(d):
    return {k: v for k, v in (d or {}).items() if not SECRET_RE.search(str(k))} if isinstance(d, dict) else {}


zones = []
for z in src['wp_woocommerce_shipping_zones']:
    zones.append({'id': z['zone_id'], 'name': z['zone_name'], 'order': z['zone_order'],
                  'locations': [{'code': l['location_code'], 'type': l['location_type']} for l in src['wp_woocommerce_shipping_zone_locations'] if l['zone_id'] == z['zone_id']],
                  'methods': [{'instance_id': mm['instance_id'], 'method_id': mm['method_id'], 'order': mm['method_order'], 'enabled': bool(mm['is_enabled']),
                               'settings': no_secrets(php_unserialize(options.get(f"woocommerce_{mm['method_id']}_{mm['instance_id']}_settings", '')))}
                              for mm in src['wp_woocommerce_shipping_zone_methods'] if mm['zone_id'] == z['zone_id']]})
settings = [
    {'key': 'woocommerce.shipping_zones', 'is_public': True, 'value': zones},
    {'key': 'woocommerce.tax', 'is_public': True, 'value': {
        'calc_taxes': options.get('woocommerce_calc_taxes') == 'yes',
        'prices_include_tax': options.get('woocommerce_prices_include_tax') == 'yes',
        'tax_based_on': options.get('woocommerce_tax_based_on'), 'shipping_tax_class': options.get('woocommerce_shipping_tax_class'),
        'round_at_subtotal': options.get('woocommerce_tax_round_at_subtotal') == 'yes',
        'display_shop': options.get('woocommerce_tax_display_shop'), 'display_cart': options.get('woocommerce_tax_display_cart'),
        'total_display': options.get('woocommerce_tax_total_display'), 'price_display_suffix': options.get('woocommerce_price_display_suffix') or '',
        'classes': [{'id': r['tax_rate_class_id'], 'name': r['name'], 'slug': r['slug']} for r in src['wp_wc_tax_rate_classes']],
        'rates': []}},
    {'key': 'woocommerce.general', 'is_public': True, 'value': {
        'default_country': options.get('woocommerce_default_country'), 'allowed_countries': options.get('woocommerce_allowed_countries'),
        'ship_to_countries': options.get('woocommerce_ship_to_countries'), 'ship_to_destination': options.get('woocommerce_ship_to_destination'),
        'enable_guest_checkout': options.get('woocommerce_enable_guest_checkout') == 'yes',
        'registration_generate_username': options.get('woocommerce_registration_generate_username') == 'yes',
        'registration_generate_password': options.get('woocommerce_registration_generate_password') == 'yes',
        'calc_discounts_sequentially': options.get('woocommerce_calc_discounts_sequentially') == 'yes',
        'checkout_address_2_field': options.get('woocommerce_checkout_address_2_field'),
        'checkout_highlight_required_fields': options.get('woocommerce_checkout_highlight_required_fields') == 'yes',
        'weight_unit': options.get('woocommerce_weight_unit'), 'dimension_unit': options.get('woocommerce_dimension_unit'),
        'hide_out_of_stock_items': options.get('woocommerce_hide_out_of_stock_items') == 'yes',
        'checkout_privacy_policy_text': options.get('woocommerce_checkout_privacy_policy_text'),
        'registration_privacy_policy_text': options.get('woocommerce_registration_privacy_policy_text')}},
    {'key': 'seo.rank_math', 'is_public': False, 'value': {
        'titles': no_secrets(php_unserialize(options.get('rank-math-options-titles', ''))),
        'general': no_secrets(php_unserialize(options.get('rank-math-options-general', ''))),
        'sitemap': no_secrets(php_unserialize(options.get('rank-math-options-sitemap', '')))}},
]


# ================================================================== draft pages (not in the public REST export)
# WP pages with post_status=draft: imported as status=draft with no public path, so they only show up
# in the admin content list / admin preview (RLS + getPostByPath only serve status=publish).
OLD_HOST_RE = re.compile(r'https?://(?:www\.)?dayinup\.com(?=[/"\'\s<]|$)/?')
draft_pages = []
for p in posts.values():
    if p['post_type'] != 'page' or p['post_status'] != 'draft' or p['ID'] in db_posts and db_posts[p['ID']]['status'] != 'draft':
        continue
    pm = postmeta.get(p['ID'], {})
    draft_pages.append({
        'id': p['ID'], 'post_type': 'page', 'slug': urllib.parse.unquote(p['post_name'] or ''), 'path': None,
        'status': 'draft', 'title': p['post_title'] or '', 'content_html': OLD_HOST_RE.sub('/', p['post_content'] or ''),
        'excerpt_html': p['post_excerpt'] or '', 'author_id': p['post_author'] or None,
        'parent_id': p['post_parent'] or None, 'menu_order': p['menu_order'] or 0,
        'comment_status': p['comment_status'] or 'closed', 'ping_status': p['ping_status'] or 'closed',
        'template': '' if pm.get('_wp_page_template') in (None, 'default') else pm['_wp_page_template'],
        'date': gmt(p['post_date_gmt']) or ((p['post_date'] + '+08:00') if p['post_date'] else None),
        'modified': gmt(p['post_modified_gmt']) or ((p['post_modified'] + '+08:00') if p['post_modified'] else None),
        'meta': clean({'source': 'wp_posts (draft)', 'elementor': pm.get('_elementor_edit_mode') == 'builder' or None}),
    })


# ================================================================== term counts
# Use WordPress' stored wp_term_taxonomy.count (= published objects actually assigned). The public
# Store API reported product_cat "all" = 77 and talk2talk = 2 although no / one product is assigned;
# the old /product-category/all/ page lists no products ("找不到符合您選擇的商品").
wp_term_count = {r['term_id']: int(r['count']) for r in src['wp_term_taxonomy']}


# ================================================================== stock fields from postmeta
# The public Store API cannot tell a variation's own stock settings from inherited ones (it reports the
# parent's managed stock), so stock_status / backorders / manage_stock / stock come from WP postmeta.
# _manage_stock=no on a variation means it follows the parent product's stock (WooCommerce 'parent').
def stock_patch(pid):
    m = postmeta.get(pid, {})
    if '_stock_status' not in m:
        return None
    managed = m.get('_manage_stock') == 'yes'
    return {'stock_status': m['_stock_status'], 'backorders': m.get('_backorders') or 'no', 'manage_stock': managed,
            'stock_quantity': int(float(m['_stock'])) if managed and m.get('_stock') not in (None, '') else None}


stock_rows = {'products': {i: stock_patch(i) for i in db_products}, 'product_variations': {i: stock_patch(i) for i in db_variations}}


# ================================================================== write
def write():
    print('writing ...')
    cur_terms = {r['id']: r for r in select_all('terms', 'id,count')}
    fixed = [i for i in cur_terms if i in wp_term_count and cur_terms[i]['count'] != wp_term_count[i]]
    for i in fixed:
        rest('PATCH', 'terms', {'count': wp_term_count[i]}, query=f'?id=eq.{i}')
    print(f'  terms: count updated on {len(fixed)} rows')
    for table, rows in stock_rows.items():
        cur = {r['id']: r for r in select_all(table, 'id,stock_status,backorders,manage_stock,stock_quantity')}
        changed = 0
        for i, patch in rows.items():
            if patch and any(cur[i][k] != v for k, v in patch.items()):
                rest('PATCH', table, patch, query=f'?id=eq.{i}')
                changed += 1
        print(f'  {table}: stock fields updated on {changed} rows')
    stale_guests = [str(g) for g in guest_alias]
    if stale_guests:   # rows from an earlier run that are now merged into the registered customer
        for t in ('orders', 'form_submissions', 'carts'):
            for g in guest_alias:
                rest('PATCH', t, {'customer_id': guest_alias[g]}, query=f'?customer_id=eq.{g}')
        rest('DELETE', 'customers', query=f"?id=in.({','.join(stale_guests)})", prefer='return=minimal')
    upsert('posts', draft_pages)
    upsert('customers', list(customers.values()))
    parents = [o for o in orders if o['parent_id'] is None]
    upsert('orders', parents)
    upsert('orders', [o for o in orders if o['parent_id'] is not None])
    upsert('order_items', order_items)
    upsert('order_notes', notes)
    upsert('coupons', coupons)
    upsert('comments', [c for c in comments if c['parent_id'] is None])
    upsert('comments', [c for c in comments if c['parent_id'] is not None])
    upsert('forms', forms)
    upsert('form_submissions', submissions)
    upsert('settings', settings)
    # menus: WP term_id replaces the HTML-inferred menu row with the same slug
    for m in menus:
        old = rest('GET', 'menus', query=f"?select=id&slug=eq.{urllib.parse.quote(m['slug'])}&id=neq.{m['id']}", prefer='')
        tmp = {**m, 'slug': m['slug'] + '--wp-import'} if old else m
        upsert('menus', [tmp])
        for o in old or []:
            rest('PATCH', 'menu_items', {'menu_id': m['id']}, query=f"?menu_id=eq.{o['id']}")
            rest('DELETE', 'menus', query=f"?id=eq.{o['id']}", prefer='return=minimal')
        if old:
            rest('PATCH', 'menus', {'slug': m['slug']}, query=f"?id=eq.{m['id']}")
    for mid in {i['menu_id'] for i in menu_items}:
        keep = ','.join(str(i['id']) for i in menu_items if i['menu_id'] == mid)
        stale = rest('GET', 'menu_items', query=f'?select=id&menu_id=eq.{mid}&id=not.in.({keep})', prefer='') or []
        for s in stale:
            rest('DELETE', 'menu_items', query=f"?id=eq.{s['id']}", prefer='return=minimal')
        if stale:
            print(f'  removed {len(stale)} stale menu_items not in WP menu {mid}')
    upsert('menu_items', menu_items, chunk=1)


# ================================================================== reconcile (counts / totals only)
def reconcile():
    print('\nreconcile (source vs site_dayinup, imported WP ids only):')
    ok = True

    def chk(label, a, b):
        nonlocal ok
        good = (abs(a - b) < 0.005) if isinstance(a, float) or isinstance(b, float) else a == b
        ok &= good
        print(f"  {'OK ' if good else 'BAD'} {label}: source={a} new={b}")

    q_orders = select_all('orders', 'id,type,status,total,customer_id,parent_id', 'id=lt.1000000')
    q_items = select_all('order_items', 'id,order_id,item_type,total,quantity', 'id=lt.1000000')
    chk('orders (dedupe legacy∪HPOS)', dedupe['union'], len(q_orders))
    for t in ('shop_order', 'shop_order_refund'):
        chk(f'  {t} count', sum(1 for o in orders if o['type'] == t), sum(1 for o in q_orders if o['type'] == t))
        chk(f'  {t} total sum', round(sum(o['total'] for o in orders if o['type'] == t), 2),
            round(sum(float(o['total']) for o in q_orders if o['type'] == t), 2))
    src_status = collections.Counter((o['type'], o['status']) for o in orders)
    new_status = collections.Counter((o['type'], o['status']) for o in q_orders)
    for k in sorted(set(src_status) | set(new_status)):
        chk(f'  status {k[0]}/{k[1]}', src_status.get(k, 0), new_status.get(k, 0))
    chk('order linked to customer', sum(1 for o in orders if o['customer_id']), sum(1 for o in q_orders if o['customer_id']))
    chk('order_items (all types)', len(src['wp_woocommerce_order_items']), len(q_items))
    for t in ('line_item', 'coupon'):
        chk(f'  {t}', sum(1 for i in order_items if i['item_type'] == t), sum(1 for i in q_items if i['item_type'] == t))
    chk('  line_item qty sum', sum(i['quantity'] for i in order_items if i['item_type'] == 'line_item'),
        sum(i['quantity'] for i in q_items if i['item_type'] == 'line_item'))
    chk('  line_item total sum', round(sum(i['total'] for i in order_items if i['item_type'] == 'line_item'), 2),
        round(sum(float(i['total']) for i in q_items if i['item_type'] == 'line_item'), 2))
    chk('order_notes', sum(1 for r in src['wp_comments'] if r['comment_type'] == 'order_note'),
        len(select_all('order_notes', 'id', 'id=lt.1000000')))
    q_c = select_all('customers', 'id,role,orders_count,total_spent', 'id=lt.1000000')
    chk('customers: wp_users', len(src['wp_users']), sum(1 for c in q_c if c['id'] < GUEST_BASE))
    chk('customers: guest lookup rows (minus merged)', sum(1 for r in lookup.values() if not r['user_id']) - len(guest_alias),
        sum(1 for c in q_c if c['id'] >= GUEST_BASE))
    src_emails = {lower(u['user_email']) for u in src['wp_users']} | {lower(r['email']) for r in lookup.values()}
    src_emails.discard(None); src_emails.discard('')
    chk('customers: rows == distinct source e-mails', len(src_emails), len(q_c))
    chk('customers: distinct e-mails == rows', len({c['email'] for c in select_all('customers', 'email', 'id=lt.1000000')}), len(q_c))
    q_stock = {r['id']: r for t in stock_rows for r in select_all(t, 'id,stock_status,backorders,manage_stock,stock_quantity')}
    chk('stock fields match postmeta', 0, sum(1 for t in stock_rows for i, pt in stock_rows[t].items()
                                              if pt and any(q_stock[i][k] != v for k, v in pt.items())))
    chk('customers: orders_count sum', sum(c['orders_count'] for c in customers.values()), sum(c['orders_count'] for c in q_c))
    q_d = select_all('posts', 'id,status,path', 'post_type=eq.page&status=eq.draft')
    chk('draft pages (status=draft, no public path)', sum(1 for p in posts.values() if p['post_type'] == 'page' and p['post_status'] == 'draft'),
        sum(1 for r in q_d if r['path'] is None))
    q_t = select_all('terms', 'id,count')
    chk('term counts match wp_term_taxonomy', 0, sum(1 for r in q_t if r['id'] in wp_term_count and r['count'] != wp_term_count[r['id']]))
    chk('coupons', sum(1 for p in posts.values() if p['post_type'] == 'shop_coupon'), len(select_all('coupons', 'id', 'id=lt.1000000')))
    chk('blog comments', len(blog_comments), len(select_all('comments', 'id', 'id=lt.1000000')))
    q_s = select_all('form_submissions', 'id,form_id', 'id=lt.1000000')
    chk('form submissions: elementor', len(src['wp_e_submissions']), sum(1 for s in q_s if ELEMENTOR_SUB_BASE <= s['id'] < FLUENT_SUB_BASE))
    chk('form submissions: fluentform', len(src['wp_fluentform_submissions']), sum(1 for s in q_s if s['id'] >= FLUENT_SUB_BASE))
    chk('forms: fluentform', len(src['wp_fluentform_forms']), len(select_all('forms', 'id', 'source=eq.fluentform')))
    for mid in nav_menus:
        q_m = select_all('menu_items', 'id,status', f'menu_id=eq.{mid}')
        chk(f'menu {mid} items (all)', sum(1 for i in menu_items if i['menu_id'] == mid), len(q_m))
        chk(f'menu {mid} items (publish)', sum(1 for i in menu_items if i['menu_id'] == mid and i['status'] == 'publish'),
            sum(1 for i in q_m if i['status'] == 'publish'))
    print(f"\n  dedupe: legacy={dedupe['legacy']} hpos={dedupe['hpos']} same-id={dedupe['both']} union={dedupe['union']}; "
          f"field conflicts (legacy wins): {dict(conflicts)}; comments skipped (post missing): {skipped_comments}")
    print('RECONCILE', 'PASS' if ok else 'FAIL')
    return ok


if not RECONCILE_ONLY:
    write()
sys.exit(0 if reconcile() else 1)
