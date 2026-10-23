/* eslint-disable @typescript-eslint/no-explicit-any */
// Markup helpers that reproduce Blocksy / WooCommerce HTML so the original theme CSS applies 1:1.
import snippets from '@/generated/snippets.json'

type Row = Record<string, any>

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** decode the few entities WP leaves in titles so we can re-escape consistently */
export function decodeEntities(s: string): string {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

export function stripTags(s: string): string {
  return decodeEntities(String(s ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

/* ---------------------------------------------------------------- money */
const SYM = '<span class="woocommerce-Price-currencySymbol" translate="no" dir="auto">&#78;&#84;&#36;</span>'

export function fmt(n: number | string | null | undefined): string {
  const v = Math.round(Number(n || 0))
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
export function money(n: number | string | null | undefined, hidden = false): string {
  return `<span class="woocommerce-Price-amount amount"${hidden ? ' aria-hidden="true"' : ''}><bdi>${SYM}${fmt(n)}</bdi></span>`
}
export function moneyText(n: number | string | null | undefined): string {
  return 'NT$' + fmt(n)
}

/** WooCommerce get_price_html() equivalent */
export function priceHtml(p: Row): string {
  // WooCommerce prints no price for non-purchasable products whose _price is empty
  if (p.is_purchasable === false && !Number(p.price) && !Number(p.regular_price)) return ''
  if (p.type === 'variable') {
    const min = Number(p.price_min ?? p.price ?? 0)
    const max = Number(p.price_max ?? p.price ?? 0)
    if (min !== max) {
      return `${money(min, true)} <span aria-hidden="true">–</span> ${money(max, true)}<span class="screen-reader-text">價格範圍：&#78;&#84;&#36;${fmt(min)} 到 &#78;&#84;&#36;${fmt(max)}</span>`
    }
    return money(min)
  }
  if (p.on_sale && p.sale_price != null && p.regular_price != null && Number(p.sale_price) < Number(p.regular_price)) {
    return saleHtml(p.regular_price, p.sale_price)
  }
  if (p.price == null && p.regular_price == null) return ''
  return money(p.price ?? p.regular_price)
}

export function saleHtml(regular: number | string, sale: number | string): string {
  return `<del aria-hidden="true">${money(regular)}</del> <span class="screen-reader-text">原始價格：&#078;&#084;&#036;${fmt(regular)}。</span><ins aria-hidden="true">${money(sale)}</ins><span class="screen-reader-text">目前價格：&#078;&#084;&#036;${fmt(sale)}。</span>`
}

/* ---------------------------------------------------------------- images */
export function img(m: Row | undefined | null, opts: { cls?: string; ratio?: string; alt?: string; lazy?: boolean; title?: boolean; itemprop?: boolean; w?: number } = {}): string {
  if (!m) return ''
  const w = m.width || 600
  const h = m.height || 400
  const alt = opts.alt ?? m.alt_text ?? ''
  const attrs = [
    opts.lazy === false ? '' : 'loading="lazy"',
    `width="${w}"`,
    `height="${h}"`,
    `src="${esc(m.public_url)}"`,
    opts.cls !== undefined ? `class="${esc(opts.cls)}"` : '',
    `alt="${esc(alt)}"`,
    'decoding="async"',
    opts.itemprop === false ? '' : 'itemprop="image"',
    opts.ratio ? `style="aspect-ratio: ${opts.ratio};"` : '',
    opts.title ? `title="${esc(m.title || '')}"` : '',
  ]
  return `<img ${attrs.filter(Boolean).join(' ')} />`
}

/* ---------------------------------------------------------------- product card (Blocksy woo card type-2) */
export function productClasses(p: Row, terms: Row[], extra: string[] = []): string {
  const cls = ['product', 'type-product', `post-${p.id}`, `status-${p.status || 'publish'}`, ...extra, p.stock_status]
  for (const t of terms.filter((t) => t.taxonomy === 'product_cat')) cls.push(`product_cat-${t.slug}`)
  if (p.featured_media_id) cls.push('has-post-thumbnail')
  if (p.on_sale) cls.push('sale')
  if (p.featured) cls.push('featured')
  cls.push('taxable', 'shipping-taxable')
  if (p.is_purchasable !== false) cls.push('purchasable')
  cls.push(`product-type-${p.type || 'simple'}`)
  return cls.filter(Boolean).join(' ')
}

export function addToCartLoop(p: Row): string {
  const atc = p.meta?.add_to_cart || {}
  const name = decodeEntities(p.name)
  const isVar = p.type === 'variable'
  const inStock = p.stock_status !== 'outofstock'
  const ajax = !isVar && inStock && p.is_purchasable !== false && p.type === 'simple'
  const text = atc.text || (isVar ? '選擇規格' : ajax ? '加入購物車' : '查看內容')
  const label = atc.description || (isVar ? `選取「${name}」選項` : ajax ? `加入購物車：「${name}」` : `深入瞭解「${name}」`)
  const href = ajax ? `?add-to-cart=${p.id}` : p.path
  const cls = ['button', `product_type_${p.type || 'simple'}`]
  if (ajax) cls.push('add_to_cart_button', 'ajax_add_to_cart')
  const sr = isVar ? ' 此產品有多種款式。 可在產品頁面選擇選項 ' : ' '
  return `<a href="${esc(href)}" aria-describedby="woocommerce_loop_add_to_cart_link_describedby_${p.id}" data-quantity="1" class="${cls.join(' ')}" data-product_id="${p.id}" data-product_sku="" aria-label="${esc(label)}" rel=""${isVar ? '' : ' data-success_message=""'}>${esc(text)}</a> <span id="woocommerce_loop_add_to_cart_link_describedby_${p.id}" class="screen-reader-text">${sr}</span>`
}

export function badge(p: Row): string {
  if (p.stock_status === 'outofstock') return '<span class="out-of-stock-badge" data-shape="type-3">售罄</span>'
  if (p.on_sale) return ' <span class="onsale" data-shape="type-3">特價</span> '
  return ''
}

export function productCard(p: Row, terms: Row[], media: Row | undefined, index: number, columns = 3): string {
  const pos = index % columns === 0 ? ['first'] : index % columns === columns - 1 ? ['last'] : []
  const name = decodeEntities(p.name)
  return `<li class="${productClasses(p, terms, pos)}"> <figure >${badge(p)}<a class="ct-media-container" href="${esc(p.path)}" aria-label="${esc(name)}">${img(media, { cls: ' wp-post-image', ratio: '16/9', alt: name, title: true })}</a></figure><h1 class="woocommerce-loop-product__title"><a class="woocommerce-LoopProduct-link woocommerce-loop-product__link" href="${esc(p.path)}" target="_self">${esc(name)}</a></h1><div class="ct-woo-card-actions" data-add-to-cart="auto-hide"> <span class="price">${priceHtml(p)}</span> ${addToCartLoop(p)} </div></li>`
}

/* ---------------------------------------------------------------- blog card */
export function postClasses(p: Row, terms: Row[], extra: string[] = []): string {
  const cls = [...extra, `post-${p.id}`, p.post_type || 'post', `type-${p.post_type || 'post'}`, 'status-publish', 'format-standard']
  if (p.featured_media_id) cls.push('has-post-thumbnail')
  cls.push('hentry')
  for (const t of terms) {
    if (t.taxonomy === 'category') cls.push(`category-${t.slug}`)
    if (t.taxonomy === 'post_tag') cls.push(`tag-${t.slug}`)
  }
  return cls.join(' ')
}

export function excerptHtml(p: Row): string {
  let ex = String(p.excerpt_html || '').trim()
  // Blocksy prints the excerpt with every ellipsis *entity* turned into '...' (surrounding spaces kept;
  // a literal U+2026 typed by the author is left alone)
  ex = ex.replace(/&#8230;|&hellip;/gi, '...')
  return ex
}

export function postCard(p: Row, terms: Row[], media: Row | undefined): string {
  const title = decodeEntities(p.title)
  return `<article class="entry-card card-content ${postClasses(p, terms)}" ><a class="ct-media-container boundless-image" href="${esc(p.path)}" aria-label="${esc(title)}">${img(media, { cls: 'attachment-medium_large size-medium_large wp-post-image', ratio: '16/9', alt: '' })}</a><h1 class="entry-title"><a href="${esc(p.path)}" rel="bookmark">${esc(title)}</a></h1><div class="entry-excerpt">${excerptHtml(p)} </div><a class="entry-button wp-element-button ct-button" href="${esc(p.path)}">閱讀全文<span class="screen-reader-text">${esc(title)}</span></a></article>`
}

/* ---------------------------------------------------------------- pagination (WP paginate_links, mid_size=2? Blocksy simple) */
export function pagination(base: string, page: number, totalPages: number, query = '', hideSm = false): string {
  if (totalPages <= 1) return ''
  const link = (n: number) => (n === 1 ? base : `${base}page/${n}/`) + query
  const parts: string[] = []
  let dots = false
  for (let n = 1; n <= totalPages; n++) {
    if (n === page) {
      parts.push(`<span aria-current="page" class="page-numbers current">${n}</span>`)
      dots = true
    } else if (n <= 1 || n > totalPages - 1 || (n >= page - 2 && n <= page + 2) || (page <= 1 && n <= 4) || (page >= totalPages && n >= totalPages - 3)) {
      parts.push(`<a class="page-numbers" href="${esc(link(n))}">${n}</a>`)
      dots = true
    } else if (dots) {
      parts.push('<span class="page-numbers dots">...</span>')
      dots = false
    }
  }
  const prev = page > 1 ? `<a class="prev page-numbers" rel="prev" href="${esc(link(page - 1))}">${prevSvg()} 上一頁</a>` : ''
  const next = page < totalPages ? `<a class="next page-numbers" rel="next" href="${esc(link(page + 1))}">下一頁 ${snippets.next_svg}</a>` : ''
  return `<nav class="ct-pagination" data-pagination="simple" > ${prev}<div class="${hideSm ? 'ct-hidden-sm' : ''}">${parts.join(' ')}</div>${next} </nav>`
}

function prevSvg(): string {
  return String(snippets.next_svg).replace('<svg', '<svg style="transform:rotate(180deg)"')
}

/* ---------------------------------------------------------------- breadcrumbs */
export function breadcrumbs(items: { name: string; url?: string }[]): string {
  const sep = snippets.breadcrumb_sep
  const out = items.map((it, i) => {
    const last = i === items.length - 1
    const cls = i === 0 ? 'first-item' : last ? 'last-item' : `item-${i - 1}`
    const inner = last
      ? `<span itemprop="name">${esc(it.name)}</span><meta itemprop="url" content="${esc(it.url || '')}"/>`
      : `<a href="${esc(it.url || '/')}" itemprop="item"><span itemprop="name">${esc(it.name)}</span></a><meta itemprop="url" content="${esc(it.url || '/')}"/>${sep}`
    return `<span class="${cls}"${last ? ' aria-current="page"' : ''} itemscope="" itemprop="itemListElement" itemtype="https://schema.org/ListItem"><meta itemprop="position" content="${i + 1}">${inner}</span>`
  })
  return `<nav class="ct-breadcrumbs" data-source="default"  itemscope="" itemtype="https://schema.org/BreadcrumbList">${out.join('')}</nav>`
}

export const SNIPPETS = snippets as Record<string, string>
