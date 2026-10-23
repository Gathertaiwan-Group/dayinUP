/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only'
import { cache } from 'react'
import pagesJson from '@/generated/pages.json'
import stkMapJson from '@/generated/stk_map.json'
import {
  getSettings, getTerms, getAuthors, getMediaMap, getPostByPath, getPostById, getPostTerms, termWithChildren,
  listPosts, listProducts, getProductTerms, getProductBySlug, getProductsByIds, PER_PAGE, type Row,
} from './data'
import { db, admin, SITE_URL } from './supabase'
import {
  esc, decodeEntities, stripTags, priceHtml, money, fmt, img, productCard, postCard, postClasses, productClasses,
  pagination, breadcrumbs, badge, addToCartLoop, SNIPPETS, excerptHtml,
} from './html'

const PAGES = pagesJson as any
const STK = stkMapJson as Record<string, Record<string, string>>

/** swap REST-render Stackable ids for the ids the live page (and its CSS) used */
function mapStk(id: number, html: string): string {
  const m = STK[String(id)]
  if (!m || !html) return html || ''
  return html.replace(/(stk-|data-block-id=")([a-z0-9]{7})\b/g, (all, pre, bid) => (m[bid] ? pre + m[bid] : all))
}
const BASE_BODY =
  'wp-custom-logo wp-embed-responsive wp-theme-blocksy theme-blocksy stk--is-blocksy-theme woocommerce-no-js elementor-default elementor-kit-511'

export type Seo = {
  title: string
  description?: string
  robots?: string
  canonical?: string
  ogType?: string
  ogTitle?: string
  ogDescription?: string
  ogImage?: string
  ogUrl?: string
  published?: string
  modified?: string
  schema?: any
  next?: string
  prev?: string
  extra?: Record<string, string>
}

export type View = {
  kind: string
  status: number
  bodyClass: string
  prefix: string
  css: string[]
  html: string
  seo: Seo
  client?: { component: 'cart' | 'checkout' | 'account' | 'order-received'; props?: any }
  floatingBar?: string
  active?: string[]
}

/* ---------------------------------------------------------------- helpers */
export function abs(u?: string | null): string | undefined {
  if (!u) return undefined
  if (/^https?:\/\//.test(u)) return u
  return SITE_URL + (u.startsWith('/') ? u : '/' + u)
}

function encPath(p: string): string {
  return p
    .split('/')
    .map((s) => (/[^\x20-\x7e]/.test(s) ? encodeURIComponent(s).toLowerCase() : s))
    .join('/')
}

/** Rank Math schema graph stored with relative @id/url → absolute */
function absSchema(schema: any): any {
  if (!schema) return undefined
  const walk = (v: any, key?: string): any => {
    if (Array.isArray(v)) return v.map((x) => walk(x))
    if (v && typeof v === 'object') {
      const o: any = {}
      for (const [k, x] of Object.entries(v)) o[k] = walk(x, k)
      return o
    }
    if (typeof v === 'string' && (key === '@id' || key === 'url' || key === 'contentUrl') && v.startsWith('/')) {
      if (v.startsWith('/wp-content/')) return v
      return SITE_URL + v
    }
    return v
  }
  return walk(schema)
}

/** Rank-Math-like graph for archives that have no stored schema */
function baseSchema(path: string, name: string, type = 'CollectionPage') {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${SITE_URL}/#organization`, name: 'DayinSHOP' },
      { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, url: SITE_URL, name: 'DayinSHOP', publisher: { '@id': `${SITE_URL}/#organization` }, inLanguage: 'zh-TW' },
      { '@type': type, '@id': `${SITE_URL}${encPath(path)}#webpage`, url: `${SITE_URL}${encPath(path)}`, name, isPartOf: { '@id': `${SITE_URL}/#website` }, inLanguage: 'zh-TW' },
    ],
  }
}

function seoFrom(row: Row, fallbackTitle: string, path: string): Seo {
  const s = row?.seo || row?.meta?.seo || {}
  return {
    title: s.title || `${fallbackTitle} - DayinUP`,
    description: s.description,
    robots: s.robots || 'follow, index, max-snippet:-1, max-video-preview:-1, max-image-preview:large',
    canonical: abs(s.canonical || encPath(path)),
    ogType: s.og_type || 'article',
    ogTitle: s.og_title || s.title || `${fallbackTitle} - DayinUP`,
    ogDescription: s.og_description || s.description,
    ogImage: s.og_image || PAGES.default_og_image,
    ogUrl: abs(s.canonical || encPath(path)),
    published: row?.date,
    modified: row?.modified,
    schema: absSchema(s.schema),
  }
}

function bodyFor(path: string, cls: string, prefix: string) {
  const snap = PAGES.pages[path]
  if (snap && snap.status === 200) return { bodyClass: snap.class as string, prefix: snap.prefix as string }
  return { bodyClass: `${cls} ${BASE_BODY} ct-elementor-default-template`, prefix }
}

function elementorCss(path: string, ids: number[]): string[] {
  const snap = PAGES.pages[path]
  const set = new Set<string>(snap?.elementor || [])
  set.add('/wp-content/uploads/elementor/css/post-511.css')
  for (const id of ids) if (PAGES.elementor_files.includes(id)) set.add(`/wp-content/uploads/elementor/css/post-${id}.css`)
  return [...set]
}

/**
 * Restrict Content Pro shortcodes on /register/* (the plugin was inactive on the old site, which printed them raw).
 * Replaced with working equivalents backed by Supabase Auth.
 */
const SHORTCODES: Record<string, string> = {
  register_form: `<form class="dayinup-register register" method="post" novalidate><p><label for="reg_username">使用者名稱</label><input type="text" name="user_login" id="reg_username" class="input" autocomplete="username" required></p><p><label for="reg_email">電子郵件</label><input type="email" name="user_email" id="reg_email" class="input" autocomplete="email" required></p><p class="woocommerce-privacy-policy-text">註冊後我們會寄送登入連結到您的信箱。</p><p><button type="submit" class="wp-element-button">註冊</button></p><p>已經有帳號了？<a href="/my-account/">登入</a></p></form>`,
  rcp_profile_editor: '<p>請先<a href="/my-account/">登入</a>，再到「<a href="/my-account/edit-account/">帳號詳細資料</a>」編輯個人資料。</p>',
  subscription_details: '<p>您的會員與訂單資訊請至「<a href="/my-account/">我的帳號</a>」查看。</p>',
  rcp_update_card: '<p>本站目前未串接線上刷卡，無需更新付款卡片；如需協助請<a href="/contact/">聯絡我們</a>。</p>',
}

/** Strip shortcodes the old site rendered via plugins we replaced with native features. */
function renderContent(html: string): string {
  return String(html || '')
    // WooCommerce Store API strips <style> from descriptions but leaves Stackable's CSS text (texturized) behind
    // (any tag, e.g. data-block-id="..."> or a <br /> inside a <p>, followed by a bare `.stk-xxxxxxx {` / `.stk-xxxxxxx ,` text run)
    .replace(/(<[^>]+>)(\s*)(\.stk-[a-z0-9]+\s*[{,][^<]*)/g, (all, open: string, ws, css: string) =>
      /^<style\b/i.test(open) ? all : `${open}${ws}<style class="stk-block-styles">${css.trim().replace(/&#8211;/g, '--').replace(/&#8217;|&#8216;/g, "'").replace(/&#8220;|&#8221;/g, '"').replace(/&gt;/g, '>').replace(/&amp;/g, '&')}</style>`)
    .replace(/<p>\s*\[(register_form|subscription_details|rcp_profile_editor|rcp_update_card)\]\s*<\/p>/g, (_, sc) => `<div class="dayinup-shortcode" data-shortcode="${sc}">${SHORTCODES[sc] || ''}</div>`)
}

/**
 * [products] shortcode output stored from the REST API uses WooCommerce's bare loop template.
 * Re-render those lists with live catalog data in Blocksy's card markup (what visitors saw on the old site).
 */
async function hydrateProductLoops(html: string): Promise<string> {
  const re = /<ul class="products columns-(\d+)"[^>]*>([\s\S]*?)<\/ul>/g
  const blocks = [...html.matchAll(re)]
  if (!blocks.length) return html
  const allIds = blocks.flatMap((m) => [...m[2].matchAll(/<li class="product type-product post-(\d+)/g)].map((x) => Number(x[1])))
  const prods = await getProductsByIds(allIds)
  const byId = new Map(prods.filter((p) => p.status === 'publish').map((p) => [p.id, p]))
  const terms = await getProductTerms([...byId.keys()])
  const media = await getMediaMap(prods.map((p) => p.featured_media_id))
  let out = html
  for (const m of blocks) {
    const cols = Number(m[1]) || 3
    const ids = [...m[2].matchAll(/<li class="product type-product post-(\d+)/g)].map((x) => Number(x[1])).filter((id) => byId.has(id))
    const cards = ids.map((id, i) => productCard(byId.get(id)!, terms.get(id) || [], media.get(byId.get(id)!.featured_media_id), i, cols)).join(' ')
    out = out.replace(m[0], `<ul class="products columns-${cols}" data-products="type-2"> ${cards} </ul>`)
  }
  return out
}

function mainWrap(inner: string, itemscope = true) {
  return `<main id="main" class="site-main hfeed"${itemscope ? ' itemscope="itemscope" itemtype="https://schema.org/CreativeWork"' : ''}>${inner}</main>`
}

const NOTICES = '<div class="blocksy-woo-messages-default woocommerce-notices-wrapper"><div class="woocommerce"></div></div>'

/* ---------------------------------------------------------------- page */
async function pageView(page: Row, path: string): Promise<View> {
  const media = await getMediaMap([page.featured_media_id])
  const cls = ['post-' + page.id, 'page', 'type-page', 'status-publish']
  if (page.featured_media_id && media.get(page.featured_media_id)) cls.push('has-post-thumbnail')
  cls.push('hentry')
  const isAccount = path === '/my-account/'
  const body = `<div class="ct-container-full" data-content="normal" > <article id="post-${page.id}" class="${cls.join(' ')}"> ${isAccount ? '' : NOTICES} <div class="entry-content is-layout-constrained"> ${await hydrateProductLoops(renderContent(mapStk(page.id, page.content_html)))} </div> </article> </div>`
  const settings = await getSettings()
  const front = Number(settings['reading.page_on_front']) === page.id
  return {
    kind: front ? 'front' : 'page',
    status: 200,
    ...bodyFor(path, `${front ? 'home ' : ''}wp-singular page-template-default page page-id-${page.id}`, 'single_page'),
    css: elementorCss(path, [page.id, 6613]),
    html: mainWrap(body, false),
    seo: seoFrom(page, decodeEntities(page.title), path),
  }
}

/* ---------------------------------------------------------------- single post */
async function postView(post: Row, path: string): Promise<View> {
  const termsMap = await getPostTerms([post.id])
  const terms = termsMap.get(post.id) || []
  const cats = terms.filter((t) => t.taxonomy === 'category')
  const primary = cats[0]
  const allTerms = await getTerms()
  const chain: Row[] = []
  for (let t: Row | undefined = primary; t; t = allTerms.find((x) => x.id === t!.parent_id)) chain.unshift(t)
  const title = decodeEntities(post.title)
  const crumbs = [{ name: '首頁', url: '/' }, ...chain.map((t) => ({ name: t.name, url: t.path })), { name: title, url: path }]

  // prev/next: Blocksy uses get_adjacent_post(in_same_term=true, taxonomy=category) -> only posts sharing a category, by date (ID breaks ties)
  let prev: Row | undefined
  let next: Row | undefined
  if (cats.length) {
    const rel = await db().from('post_terms').select('post_id').in('term_id', cats.map((c) => c.id))
    if (rel.error) throw rel.error
    const ids = [...new Set((rel.data || []).map((r) => r.post_id))].filter((id) => id !== post.id)
    if (ids.length) {
      const cand = await db().from('posts').select('id,path,title,featured_media_id,date').eq('post_type', 'post').eq('status', 'publish').in('id', ids)
      if (cand.error) throw cand.error
      const key = (r: Row) => [new Date(r.date).getTime(), Number(r.id)] as const
      const cmp = (a: Row, b: Row) => { const [ad, ai] = key(a), [bd, bi] = key(b); return ad - bd || ai - bi }
      const sorted = (cand.data || []).sort(cmp)
      prev = sorted.filter((r) => cmp(r, post) < 0).pop()
      next = sorted.find((r) => cmp(r, post) > 0)
    }
  }
  // related: same categories
  const related = primary ? await listPosts({ termIds: cats.map((c) => c.id), perPage: 8, excludeId: post.id }) : { rows: [], total: 0 }
  const relTerms = await getPostTerms(related.rows.map((r) => r.id))
  const media = await getMediaMap([post.featured_media_id, prev?.featured_media_id, next?.featured_media_id, ...related.rows.map((r) => r.featured_media_id)])
  const fm = media.get(post.featured_media_id)

  const shareUrl = encodeURIComponent(SITE_URL + encPath(path))
  const shareTitle = encodeURIComponent(title)
  const share = String(SNIPPETS.share_box)
    .replace(/u=[^"&]*/, `u=${shareUrl}`)
    .replace(/(lineit\/share\?url=)[^"&]*(&amp;text=)[^"]*/, `$1${shareUrl}$2${shareTitle}`)
    .replace(/(shareArticle\?url=)[^"&]*(&amp;title=)[^"]*/, `$1${shareUrl}$2${shareTitle}`)
    .replace(/(intent\/post\?text=)[^"]*/, `$1${shareUrl}`)
    .replace(/href="mailto:[^"]*"/, `href="mailto:?subject=${shareTitle}&amp;body=${shareUrl}"`)

  const arrowL = '<svg width="20px" height="15px" viewBox="0 0 20 15" fill="#ffffff"><polygon points="0,7.5 5.5,13 6.4,12.1 2.4,8.1 20,8.1 20,6.9 2.4,6.9 6.4,2.9 5.5,2 "/></svg>'
  const arrowR = '<svg width="20px" height="15px" viewBox="0 0 20 15" fill="#ffffff"><polygon points="14.5,2 13.6,2.9 17.6,6.9 0,6.9 0,8.1 17.6,8.1 13.6,12.1 14.5,13 20,7.5 "/></svg>'
  const navItem = (p: Row | undefined, dir: 'prev' | 'next') =>
    p
      ? `<a href="${esc(p.path)}" class="nav-item-${dir}"> <figure class="ct-media-container ct-hidden-sm ct-hidden-md ct-hidden-lg">${img(media.get(p.featured_media_id), { cls: 'attachment-large size-large wp-post-image', ratio: '1/1' })}${dir === 'prev' ? arrowL : arrowR}</figure> <div class="item-content"> <span class="item-label"> ${dir === 'prev' ? '上一' : '下一'} <span>文章</span> </span> <span class="item-title ct-hidden-sm ct-hidden-md ct-hidden-lg"> ${esc(decodeEntities(p.title))} </span> </div> </a>`
      : `<div class="nav-item-${dir}"></div>`
  const postNav = `<nav class="post-navigation is-width-constrained ct-hidden-sm ct-hidden-md" > ${navItem(prev, 'prev')} ${navItem(next, 'next')} </nav>`

  const comments = post.comment_status === 'open' || true ? commentForm(post.id, path) : ''
  const rel = related.rows.length
    ? `<div class="ct-related-posts-container" > <div class="ct-container"> <div class="ct-related-posts" > <h3 class="ct-module-title"> 相關文章 </h3> <div class="ct-related-posts-items" data-layout="grid" data-hover="zoom-in"> ${related.rows
        .map(
          (r) =>
            `<article itemscope="itemscope" itemtype="https://schema.org/CreativeWork"><div id="post-${r.id}" class="${postClasses(r, relTerms.get(r.id) || [])}"><a class="ct-media-container has-hover-effect" href="${esc(r.path)}" aria-label="${esc(decodeEntities(r.title))}">${img(media.get(r.featured_media_id), { cls: 'attachment-medium_large size-medium_large wp-post-image', ratio: '16/9' })}</a><h4 class="related-entry-title"><a href="${esc(r.path)}" rel="bookmark">${esc(decodeEntities(r.title))}</a></h4></div></article>`,
        )
        .join(' ')}</div> </div> </div> </div>`
    : ''

  const article = `<div class="ct-container-full" data-content="normal" data-vertical-spacing="top:bottom"> <article id="post-${post.id}" class="${postClasses(post, terms)}"> ${NOTICES} <div class="hero-section is-width-constrained" data-type="type-1"> <header class="entry-header"> ${breadcrumbs(crumbs)} </header> </div>${fm ? `<figure class="ct-featured-image "><div class="ct-media-container">${img(fm, { cls: 'attachment-medium size-medium wp-post-image', ratio: '16/9' })}</div></figure>` : ''} <div class="entry-content is-layout-constrained"> ${await hydrateProductLoops(renderContent(mapStk(post.id, post.content_html)))} </div> ${share} ${postNav} ${comments} </article> </div> ${rel}`
  const seo = seoFrom(post, title, path)
  return {
    kind: 'post',
    status: 200,
    ...bodyFor(path, `wp-singular post-template-default single single-post postid-${post.id} single-format-standard elementor-page elementor-page-${post.id}`, 'single_blog_post'),
    css: elementorCss(path, [post.id]),
    html: mainWrap(article),
    seo,
  }
}

function commentForm(postId: number, path: string): string {
  return `<div class="ct-comments is-width-constrained" id="comments"> <div id="respond" class="comment-respond"> <h2 id="reply-title" class="comment-reply-title">發佈留言<span class="ct-cancel-reply"><a rel="nofollow" id="cancel-comment-reply-link" href="${esc(path)}#respond" style="display:none;">取消回覆</a></span></h2><form action="/api/forms/commentform/" method="post" id="commentform" class="comment-form has-website-field has-labels-inside" data-dayinup-form="commentform"><p class="comment-notes"><span id="email-notes">發佈留言必須填寫的電子郵件地址不會公開。</span> <span class="required-field-message">必填欄位標示為 <span class="required">*</span></span></p><p class="comment-form-field-input-author"> <label for="author">名稱 <b class="required">&nbsp;*</b></label> <input id="author" name="author" type="text" value="" size="30" required='required'> </p> <p class="comment-form-field-input-email"> <label for="email">電子郵件 <b class="required">&nbsp;*</b></label> <input id="email" name="email" type="text" value="" size="30" required='required'> </p> <p class="comment-form-field-input-url"> <label for="url">網站</label> <input id="url" name="url" type="text" value="" size="30"> </p> <p class="comment-form-field-textarea"> <label for="comment">新增留言<b class="required">&nbsp;*</b></label> <textarea id="comment" name="comment" cols="45" rows="8" required="required"></textarea> </p><p class="comment-form-cookies-consent"><input id="wp-comment-cookies-consent" name="wp-comment-cookies-consent" type="checkbox" value="yes"><label for="wp-comment-cookies-consent">將我的姓名、電子郵件和網站保存在此瀏覽器中，以便下次留言時使用。</label></p><p class="form-submit"><button type="submit" name="submit" id="submit" class="submit" value="發佈留言">發佈留言</button> <input type='hidden' name='comment_post_ID' value='${postId}' id='comment_post_ID' /> <input type='hidden' name='comment_parent' id='comment_parent' value='0' /> </p></form> </div><!-- #respond --> </div>`
}

/* ---------------------------------------------------------------- archives */
async function postArchive(opts: {
  kind: string
  path: string
  page: number
  termIds?: number[]
  authorId?: number
  search?: string
  bodyCls: string
  prefix: string
  seo: Seo
  heroTitle?: string
  heroDesc?: string
  query?: string
  types?: string[]
  layout?: 'grid' | 'simple'
  perPage?: number
}): Promise<View> {
  const perPage = opts.perPage ?? PER_PAGE
  const { rows, total } = await listPosts({ termIds: opts.termIds, authorId: opts.authorId, search: opts.search, page: opts.page, types: opts.types, perPage })
  const pages = Math.ceil(total / perPage)
  if (opts.page > 1 && opts.page > pages) return notFoundView(opts.path)
  const termsMap = await getPostTerms(rows.map((r) => r.id))
  const media = await getMediaMap(rows.map((r) => r.featured_media_id))
  const hero = opts.heroTitle
    ? `<div class="hero-section is-width-constrained" data-type="type-1"> <header class="entry-header"> <h1 class="page-title" itemprop="headline">${esc(opts.heroTitle)}</h1>${opts.heroDesc ? `<div class="page-description ct-hidden-sm">${opts.heroDesc}</div>` : ''}		</header> </div>`
    : ''
  let inner: string
  if (!rows.length) {
    inner = `<div class="ct-container"  data-vertical-spacing="top:bottom"> <section class="ct-no-results"> ${hero}<div class="entry-content is-layout-flow"> ${SNIPPETS.search_form} </div> </section> </div>`
  } else {
    const simple = opts.layout === 'simple'
    const cards = rows.map((r) => (simple ? simpleCard(r, termsMap.get(r.id) || [], media.get(r.featured_media_id)) : r.post_type === 'post' ? postCard(r, termsMap.get(r.id) || [], media.get(r.featured_media_id)) : searchCard(r, media.get(r.featured_media_id)))).join('')
    inner = `<div class="ct-container"  data-vertical-spacing="top:bottom"> <section > ${hero}<div class="entries" data-archive="default" data-layout="${simple ? 'simple' : 'grid'}" data-cards="boxed">${cards}</div> ${pagination(opts.path, opts.page, pages, opts.query || '', true)} </section> </div>`
  }
  const seo = { ...opts.seo }
  if (opts.page < pages) seo.next = abs(encPath(`${opts.path}page/${opts.page + 1}/`) + (opts.query || ''))
  if (opts.page > 1) seo.prev = abs(encPath(opts.page === 2 ? opts.path : `${opts.path}page/${opts.page - 1}/`) + (opts.query || ''))
  if (opts.page > 1) {
    seo.title = seo.title.replace(/ - DayinUP$/, ` - 第 ${opts.page} 頁 - DayinUP`)
    seo.canonical = abs(encPath(`${opts.path}page/${opts.page}/`))
    seo.ogUrl = seo.canonical
  }
  return {
    kind: opts.kind,
    status: 200,
    ...(opts.page === 1 ? bodyFor(opts.path, opts.bodyCls, opts.prefix) : { bodyClass: `${opts.bodyCls} paged paged-${opts.page} ${BASE_BODY} ct-elementor-default-template`, prefix: opts.prefix }),
    css: elementorCss(opts.path, []),
    html: mainWrap(inner),
    seo,
  }
}

const ARROW_R = '<svg width="17px" height="17px" viewBox="0 0 32 32" fill="currentColor"><path d="M 21.1875 9.28125 L 19.78125 10.71875 L 24.0625 15 L 4 15 L 4 17 L 24.0625 17 L 19.78125 21.28125 L 21.1875 22.71875 L 27.90625 16 Z "></path></svg>'

/** Blocksy "simple" archive card (author archive) */
function simpleCard(r: Row, terms: Row[], m: Row | undefined): string {
  const title = decodeEntities(r.title)
  return `<article class="entry-card ${postClasses(r, terms)}" ><a class="ct-media-container boundless-image" href="${esc(r.path)}" aria-label="${esc(title)}">${img(m, { cls: 'attachment-medium_large size-medium_large wp-post-image', ratio: '2/1', alt: '' })}</a><div class="card-content"><h2 class="entry-title"><a href="${esc(r.path)}" rel="bookmark">${esc(title)}</a></h2><div class="entry-excerpt">${excerptHtml(r)} </div><a class="entry-button" href="${esc(r.path)}">閱讀全文${ARROW_R}<span class="screen-reader-text">${esc(title)}</span></a></div></article>`
}

function searchCard(r: Row, m: Row | undefined): string {
  const title = decodeEntities(r.title || r.name)
  return `<article class="entry-card card-content post-${r.id} ${r.post_type} type-${r.post_type} status-publish hentry" ><a class="ct-media-container boundless-image" href="${esc(r.path)}" aria-label="${esc(title)}">${img(m, { cls: 'attachment-medium_large size-medium_large wp-post-image', ratio: '16/9' })}</a><h1 class="entry-title"><a href="${esc(r.path)}" rel="bookmark">${esc(title)}</a></h1><div class="entry-excerpt">${r.excerpt_html ? String(r.excerpt_html).replace(/(&#8230;|&hellip;)/, '...') : ''} </div><a class="entry-button wp-element-button ct-button" href="${esc(r.path)}">閱讀全文<span class="screen-reader-text">${esc(title)}</span></a></article>`
}

async function productArchive(opts: { kind: string; path: string; page: number; termIds?: number[]; orderby?: string; bodyCls: string; seo: Seo; query: string }): Promise<View> {
  const { rows, total } = await listProducts({ termIds: opts.termIds, page: opts.page, orderby: opts.orderby })
  const pages = Math.ceil(total / PER_PAGE)
  if (opts.page > 1 && opts.page > pages) return notFoundView(opts.path)
  const termsMap = await getProductTerms(rows.map((r) => r.id))
  const media = await getMediaMap(rows.map((r) => r.featured_media_id))
  const cards = rows.map((r, i) => productCard(r, termsMap.get(r.id) || [], media.get(r.featured_media_id), i)).join(' ')
  const orderSel = orderingForm(opts.orderby || 'menu_order', opts.path) + (await categoryFilter(opts.path))
  const list = rows.length
    ? `<ul class="products columns-3" data-products="type-2"> ${cards} </ul> ${pagination(opts.path, opts.page, pages, opts.query)}`
    : '<div class="woocommerce-no-products-found"> <div class="woocommerce-info" role="status"> 找不到符合您選擇的商品 </div> </div>'
  const inner = `<div class="ct-container"  data-vertical-spacing="top:bottom"><section><header class="woocommerce-products-header"> 	 	</header> <div class="woocommerce-notices-wrapper"></div><div class="woo-listing-top">${orderSel}</div>${list}</section></div>`
  const seo = { ...opts.seo }
  if (opts.page < pages) seo.next = abs(encPath(`${opts.path}page/${opts.page + 1}/`))
  if (opts.page > 1) {
    seo.prev = abs(encPath(opts.page === 2 ? opts.path : `${opts.path}page/${opts.page - 1}/`))
    seo.title = seo.title.replace(/ - DayinUP$/, ` - 第 ${opts.page} 頁 - DayinUP`)
    seo.canonical = abs(encPath(`${opts.path}page/${opts.page}/`))
  }
  return {
    kind: opts.kind,
    status: 200,
    ...(opts.page === 1 ? bodyFor(opts.path, opts.bodyCls, 'woo_categories') : { bodyClass: `${opts.bodyCls} paged paged-${opts.page} ${BASE_BODY} ct-elementor-default-template`, prefix: 'woo_categories' }),
    css: elementorCss(opts.path, []),
    html: mainWrap(inner),
    seo,
  }
}

/** Product category filter (navigates to the category archive, keeps WP permalinks). */
async function categoryFilter(current: string): Promise<string> {
  const terms = (await getTerms()).filter((t) => t.taxonomy === 'product_cat' && t.count > 0)
  const parent = terms.find((t) => !t.parent_id && t.slug === 'activities')
  const ordered = [...terms.filter((t) => !t.parent_id), ...terms.filter((t) => t.parent_id)]
  return `<form class="dayinup-cat-filter" data-dayinup-catfilter><select aria-label="商品分類" class="orderby"><option value="/shop/"${current === '/shop/' ? ' selected' : ''}>全部分類</option>${ordered
    .map((t) => `<option value="${esc(t.path)}"${t.path === current ? ' selected' : ''}>${t.parent_id && parent ? '　' : ''}${esc(t.name)}</option>`)
    .join('')}</select></form>`
}

/** WooCommerce catalog ordering (?orderby=), compact so it fits the archive's top spacing like the old layout. */
function orderingForm(cur: string, path: string): string {
  const opts: [string, string][] = [
    ['menu_order', '預設排序'],
    ['popularity', '依熱銷度'],
    ['date', '依最新項目排序'],
    ['price', '依價格排序：低至高'],
    ['price-desc', '依價格排序：高至低'],
  ]
  return `<form class="woocommerce-ordering" method="get" action="${esc(path)}" data-dayinup-ordering><select name="orderby" class="orderby" aria-label="商店訂單">${opts
    .map(([v, l]) => `<option value="${v}"${v === cur ? ' selected="selected"' : ''}>${l}</option>`)
    .join('')}</select><input type="hidden" name="paged" value="1" /></form>`
}

/* ---------------------------------------------------------------- product */
async function productView(slug: string, path: string): Promise<View | null> {
  const p = await getProductBySlug(slug)
  if (!p) return null
  const termsMap = await getProductTerms([p.id])
  const terms = termsMap.get(p.id) || []
  const imgIds: number[] = [p.featured_media_id, ...p.images.map((i: Row) => i.media_id)].filter(Boolean)
  const galleryIds = [...new Set(imgIds)]
  // related: share a product_cat (exclude parent-only "activities"), random-ish but stable: newest first
  const cats = terms.filter((t) => t.taxonomy === 'product_cat')
  const relIdsQ = cats.length
    ? await db().from('product_terms').select('product_id').in('term_id', cats.map((t) => t.id)).neq('product_id', p.id)
    : { data: [] as Row[] }
  const relIds = [...new Set((relIdsQ.data || []).map((r: Row) => r.product_id))]
  let related = await getProductsByIds(relIds)
  related = related.filter((r) => r.status === 'publish').sort((a, b) => (seeded(p.id, a.id) - seeded(p.id, b.id))).slice(0, 4)
  const relTerms = await getProductTerms(related.map((r) => r.id))
  const media = await getMediaMap([...galleryIds, ...related.map((r) => r.featured_media_id), ...p.variations.map((v: Row) => v.image_media_id)])
  const name = decodeEntities(p.name)

  // gallery
  const fig = (m: Row | undefined) =>
    m ? `<figure class="ct-media-container" data-src="${esc(m.public_url)}" data-width="${m.width}" data-height="${m.height}">${img(m, { cls: galleryIds.length > 1 ? '' : ' wp-post-image', ratio: '16/9', alt: name, title: true })}</figure>` : ''
  let gallery: string
  if (galleryIds.length > 1) {
    const arrows = `<span class="flexy-arrow-prev"> <svg width="16" height="10" fill="currentColor" viewBox="0 0 16 10"><path d="M15.3 4.3h-13l2.8-3c.3-.3.3-.7 0-1-.3-.3-.6-.3-.9 0l-4 4.2-.2.2v.6c0 .1.1.2.2.2l4 4.2c.3.4.6.4.9 0 .3-.3.3-.7 0-1l-2.8-3h13c.2 0 .4-.1.5-.2s.2-.3.2-.5-.1-.4-.2-.5c-.1-.1-.3-.2-.5-.2z"></path></svg> </span> <span class="flexy-arrow-next"> <svg width="16" height="10" fill="currentColor" viewBox="0 0 16 10"><path d="M.2 4.5c-.1.1-.2.3-.2.5s.1.4.2.5c.1.1.3.2.5.2h13l-2.8 3c-.3.3-.3.7 0 1 .3.3.6.3.9 0l4-4.2.2-.2V5v-.3c0-.1-.1-.2-.2-.2l-4-4.2c-.3-.4-.6-.4-.9 0-.3.3-.3.7 0 1l2.8 3H.7c-.2 0-.4.1-.5.2z"></path></svg> </span>`
    gallery = `<div class="woocommerce-product-gallery"><div class="ct-product-gallery-container">${badge(p)} <div class="flexy-container" data-flexy="no"> <div class="flexy"> <div class="flexy-view" data-flexy-view="boxed"> <div class="flexy-items">${galleryIds.map((id) => `<div class="flexy-item">${fig(media.get(id))}</div>`).join('')} </div> </div> ${arrows} </div> <div class="flexy-pills" data-type="thumbs"><ol>${galleryIds
      .map((id, i) => `<li${i === 0 ? ' class="active"' : ''}><span class="ct-media-container" aria-label="幻燈片 ${i + 1}">${img(media.get(id), { cls: '', ratio: '1/1', alt: name, title: true })}</span></li>`)
      .join('')}</ol></div> </div></div></div>`
  } else {
    gallery = `<div class="woocommerce-product-gallery"><div class="ct-product-gallery-container">${badge(p)}${fig(media.get(galleryIds[0]))}</div></div>`
  }

  // add to cart
  const inStock = p.stock_status !== 'outofstock'
  const qty = `<div class="quantity" data-type="type-2"> <span class="ct-increase"></span><span class="ct-decrease"></span> <label class="screen-reader-text" for="quantity_${p.id}">${esc(name)} 數量</label> <input type="number" id="quantity_${p.id}" class="input-text qty text" name="quantity" value="1" aria-label="商品數量" min="1" step="1" placeholder="" inputmode="numeric" autocomplete="off" /> </div>`
  let atc = ''
  if (p.type === 'variable' && p.variations.length) {
    const attr = p.attributes.find((a: Row) => a.is_variation) || p.attributes[0] || { name: '票種', options: [] }
    const attrKey = 'attribute_' + encodeURIComponent(attr.name).toLowerCase()
    const options: string[] = attr.options?.length ? attr.options : p.variations.map((v: Row) => v.attributes?.[attr.name]).filter(Boolean)
    const rulesByVar = new Map<number, Row>()
    for (const r of p.discount_rules) if (r.variation_id) rulesByVar.set(r.variation_id, r)
    const vdata = p.variations.map((v: Row) => {
      const r = rulesByVar.get(v.id)
      const onSale = v.sale_price != null && Number(v.sale_price) < Number(v.regular_price)
      return {
        attributes: { [attrKey]: v.attributes?.[attr.name] ?? '' },
        variation_id: v.id,
        display_price: Number(v.price ?? v.regular_price ?? 0),
        display_regular_price: Number(v.regular_price ?? v.price ?? 0),
        is_in_stock: v.stock_status !== 'outofstock',
        backorders_allowed: v.backorders !== 'no' || v.stock_status === 'onbackorder',
        is_purchasable: v.is_purchasable !== false,
        max_qty: v.manage_stock && v.stock_quantity > 0 && v.stock_status !== 'onbackorder' ? v.stock_quantity : '',
        min_qty: 1,
        price_html: `<span class="price">${onSale ? `<span class="sale-price">${priceSale(v.regular_price, v.sale_price)}</span>` : money(v.price ?? v.regular_price)}</span>`,
        availability_html: v.stock_status === 'outofstock' ? '<p class="stock out-of-stock">缺貨</p>' : '',
        discount_html: r ? discountLine(r, v) : '',
        image: v.image_media_id && media.get(v.image_media_id) ? { src: media.get(v.image_media_id)!.public_url } : null,
      }
    })
    const available = (o: string) => p.variations.some((v: Row) => v.attributes?.[attr.name] === o && v.stock_status !== 'outofstock' && v.is_purchasable !== false)
    const radios = options
      .map((o) => `<div class="tag-list"><input type="radio" style="display:none" id="${esc(attrKey + '-' + o)}" name="${esc(attrKey)}" value="${esc(o)}" ${available(o) ? '' : 'disabled'}><label for="${esc(attrKey + '-' + o)}">${esc(o)}</label></div>`)
      .join('')
    atc = `<div class="ct-product-add-to-cart"> <form class="variations_form cart" action="${esc(path)}" method="post" enctype='multipart/form-data' data-product_id="${p.id}" data-product_variations="${esc(JSON.stringify(vdata))}" data-dayinup-cart> <table class="variations" cellspacing="0" role="presentation"> <tbody> <tr> <th class="label"><label for="${esc(encodeURIComponent(attr.name).toLowerCase())}">${esc(attr.name)}</label></th> <td class="value"> <div class="variation-radios tag">${radios}</div><select id="${esc(encodeURIComponent(attr.name).toLowerCase())}" class="" name="${esc(attrKey)}" data-attribute_name="${esc(attrKey)}" data-show_option_none="yes"><option value="">請選取一個選項</option>${options
      .map((o) => `<option value="${esc(o)}" >${esc(o)}</option>`)
      .join('')}</select><a class="reset_variations" href="#" aria-label="清除選項" style="visibility:hidden">清除</a> </td> </tr> </tbody> </table> <div class="reset_variations_alert screen-reader-text" role="alert" aria-live="polite" aria-relevant="all"></div> <div class="single_variation_wrap"> <div class="woocommerce-variation single_variation" role="alert" aria-relevant="additions" style="display:none"></div><div class="woocommerce-variation-add-to-cart variations_button woocommerce-variation-add-to-cart-disabled"> <div class="ct-cart-actions">${qty} <button type="submit" class="single_add_to_cart_button button alt disabled wc-variation-selection-needed">加入購物車</button> </div> <input type="hidden" name="add-to-cart" value="${p.id}" /> <input type="hidden" name="product_id" value="${p.id}" /> <input type="hidden" name="variation_id" class="variation_id" value="0" /> </div> </div> </form> </div>`
  } else if (inStock && p.is_purchasable !== false) {
    atc = `<div class="ct-product-add-to-cart"> <form class="cart" action="${esc(path)}" method="post" enctype='multipart/form-data' data-product_id="${p.id}" data-dayinup-cart> <div class="ct-cart-actions">${qty} <button type="submit" name="add-to-cart" value="${p.id}" class="single_add_to_cart_button button alt">加入購物車</button> </div> </form> </div>`
  } else if (p.is_purchasable === false) {
    atc = ''
  } else {
    atc = '<div class="ct-product-add-to-cart"><p class="stock out-of-stock">已售完</p> </div>'
  }

  const short = p.short_description_html ? `<span class="ct-product-divider" data-id="STz1CliKp__Fs5TUNSf3-"></span><div class="woocommerce-product-details__short-description"> ${mapStk(p.id, p.short_description_html)} </div>` : ''
  const qtyDiscount = p.discount_rules.length ? quantityDiscountTable(p) : ''
  const attrsTable = p.attributes.filter((a: Row) => a.is_visible).length
    ? `<div class="woocommerce-Tabs-panel woocommerce-Tabs-panel--additional_information panel entry-content wc-tab is-layout-constrained" id="tab-additional_information" role="tabpanel" aria-labelledby="tab-title-additional_information" style="display:none"> <table class="woocommerce-product-attributes shop_attributes" aria-label="商品詳細資料">${p.attributes
        .filter((a: Row) => a.is_visible)
        .map((a: Row) => `<tr class="woocommerce-product-attributes-item woocommerce-product-attributes-item--attribute_${esc(encodeURIComponent(a.name).toLowerCase())}"> <th class="woocommerce-product-attributes-item__label" scope="row">${esc(a.name)}</th> <td class="woocommerce-product-attributes-item__value"><p>${esc((a.options || []).join(', '))}</p> </td> </tr>`)
        .join('')} </table> </div>`
    : ''
  const tabs = `<div class="woocommerce-tabs wc-tabs-wrapper" data-type="type-1:center" > <ul class="tabs wc-tabs is-width-constrained" role="tablist"> <li role="presentation" class="description_tab active" id="tab-title-description"> <a href="#tab-description" role="tab" aria-controls="tab-description"> 描述 </a> </li>${attrsTable ? ` <li role="presentation" class="additional_information_tab" id="tab-title-additional_information"> <a href="#tab-additional_information" role="tab" aria-controls="tab-additional_information"> 額外資訊 </a> </li>` : ''} </ul> <article> <div class="woocommerce-Tabs-panel woocommerce-Tabs-panel--description panel entry-content wc-tab is-layout-constrained" id="tab-description" role="tabpanel" aria-labelledby="tab-title-description"> ${await hydrateProductLoops(renderContent(mapStk(p.id, p.description_html)))} </div> ${attrsTable} </article> </div>`
  const relHtml = related.length
    ? `<section class="related products is-width-constrained"> <h2 class="ct-module-title">相關商品</h2> <ul class="products columns-4" data-products="type-2"> ${related.map((r, i) => productCard(r, relTerms.get(r.id) || [], media.get(r.featured_media_id), i, 4)).join(' ')} </ul> </section>`
    : ''
  const html = mainWrap(
    `<div class="ct-container-full" data-content="normal"  data-vertical-spacing="top:bottom"><article class="post-${p.id}"> <div class="woocommerce-notices-wrapper"></div><div id="product-${p.id}" class="${productClasses(p, terms, ['first'])} ct-default-gallery"> <div class="product-entry-wrapper is-width-constrained">${gallery} <div class="summary entry-summary entry-summary-items"> <h1 class="product_title entry-title">${esc(name)}</h1><span class="ct-product-divider" data-id="i25rVXYM0yQzQlHp0EsFJ"></span><p class="price">${priceHtml(p)}</p> <span class="ct-product-divider" data-id="divider_1"></span>${atc}${short}${qtyDiscount} </div> </div> ${tabs} ${relHtml} </div> </article> </div>`,
  )
  const floating = `<div class="ct-floating-bar" > <div class="ct-container"> <section class="ct-floating-bar-content"> <div class="ct-media-container">${img(media.get(p.featured_media_id), { cls: '', ratio: '1/1', alt: name, title: true }).replace(/width="\d+" height="\d+"/, 'width="100" height="100"')}</div> <div class="ct-floating-bar-item-title"> <div class="product-title">${esc(name)}</div> <p class="price">${priceHtml(p)}</p> </div> </section> <section class="ct-floating-bar-actions"> ${addToCartLoop(p).replace('class="button', p.type === 'variable' ? 'class="button' : 'class="button').replace(/class="button product_type_variable"/, 'class="button product_type_variable add_to_cart_button"')} </section> </div> </div>`
  return {
    kind: 'product',
    status: 200,
    ...bodyFor(path, `wp-singular product-template-default single single-product postid-${p.id} woocommerce woocommerce-page`, 'product'),
    css: elementorCss(path, [p.id]),
    html,
    seo: seoFrom(p, name, path),
    floatingBar: floating,
    active: terms.filter((t) => t.taxonomy === 'product_cat').map((t) => t.path),
  }
}

function seeded(a: number, b: number) {
  const x = Math.sin(a * 9301 + b * 49297) * 233280
  return x - Math.floor(x)
}

function priceSale(regular: any, sale: any) {
  return `<del aria-hidden="true">${money(regular)}</del> <span class="screen-reader-text">原始價格：&#078;&#084;&#036;${fmt(regular)}。</span><ins aria-hidden="true">${money(sale)}</ins><span class="screen-reader-text">目前價格：&#078;&#084;&#036;${fmt(sale)}。</span>`
}

function discountLine(r: Row, v: Row): string {
  const pct = Number(r.discount_value)
  const zhe = r.discount_type === 'percent' ? `${String(100 - pct).replace(/0$/, '')} 折` : ''
  const per = r.persons && r.persons > 1 && v.price ? `，每人約 NT$${fmt(Number(v.price) / r.persons)}` : ''
  return `<p class="dayinup-discount">已套用優惠：${esc(r.label.replace(/^🎫\s*/, ''))}${zhe ? `（${zhe}）` : ''}${per}</p>`
}

function quantityDiscountTable(p: Row): string {
  const rows = p.discount_rules
    .map((r: Row) => {
      const v = p.variations.find((x: Row) => x.id === r.variation_id)
      const pct = Number(r.discount_value)
      const zhe = r.discount_type === 'percent' ? `${String(100 - pct).replace(/0$/, '')} 折` : r.discount_type === 'fixed_price' ? `NT$${fmt(r.discount_value)}` : `折 NT$${fmt(r.discount_value)}`
      return `<tr><td>${esc(r.label.replace(/^🎫\s*/, ''))}</td><td>${r.persons ? `${r.persons} 人` : '—'}</td><td>${zhe}</td><td>${v ? priceSaleOrMoney(v) : ''}</td></tr>`
    })
    .join('')
  return `<details class="dayinup-qty-discounts"><summary>票種與團報優惠</summary><table class="shop_table"><thead><tr><th>票種</th><th>人數</th><th>優惠</th><th>價格</th></tr></thead><tbody>${rows}</tbody></table></details>`
}
function priceSaleOrMoney(v: Row) {
  return v.sale_price != null && Number(v.sale_price) < Number(v.regular_price) ? priceSale(v.regular_price, v.sale_price) : money(v.price ?? v.regular_price)
}

/* ---------------------------------------------------------------- simple pages: cart / checkout / account / 404 */
function shellPage(path: string, pageId: number, bodyCls: string, inner: string): Pick<View, 'bodyClass' | 'prefix' | 'html'> {
  return {
    ...bodyFor(path, bodyCls, 'single_page'),
    html: mainWrap(`<div class="ct-container-full" data-content="normal" > <article id="post-${pageId}" class="post-${pageId} page type-page status-publish hentry"> <div class="entry-content is-layout-constrained"> ${inner} </div> </article> </div>`, false),
  }
}

export function notFoundView(path: string): View {
  return {
    kind: '404',
    status: 404,
    bodyClass: `error404 ${BASE_BODY} ct-elementor-default-template`,
    prefix: '',
    css: ['/wp-content/uploads/elementor/css/post-511.css'],
    html: mainWrap(
      `<div class="ct-container" data-vertical-spacing="top:bottom"> <section class="ct-no-results"> <section class="hero-section" data-type="type-1"> <header class="entry-header"> <h1 class="page-title" itemprop="headline"> 很抱歉，找不到符合條件的頁面。 </h1> <div class="page-description"> 看起來在這個位置找不到東西. 也許可以試著找其他的? </div> </header> </section> <div class="entry-content is-layout-flow"> ${SNIPPETS.search_form} </div> </section> </div>`,
      false,
    ),
    seo: { title: 'Page Not Found - DayinUP', robots: 'follow, noindex', ogType: 'article', ogTitle: 'Page Not Found - DayinUP', ogImage: PAGES.default_og_image, schema: baseSchema(path, 'Page Not Found - DayinUP', 'WebPage') },
  }
}

/* ---------------------------------------------------------------- resolver */
export const resolveView = cache(async (segments: string[], sp: Record<string, string | undefined>): Promise<View> => {
  const segs = segments.map((s) => {
    try {
      return decodeURIComponent(s).normalize('NFC')
    } catch {
      return s
    }
  })
  let page = 1
  if (segs.length >= 2 && segs[segs.length - 2] === 'page' && /^\d+$/.test(segs[segs.length - 1])) {
    page = parseInt(segs[segs.length - 1], 10)
    segs.splice(-2, 2)
  }
  const path = '/' + segs.join('/') + (segs.length ? '/' : '')
  const settings = await getSettings()
  const allTerms = await getTerms()

  // search (?s=) on any archive root
  if (sp.s !== undefined && (path === '/' || segs[0] === 'search')) {
    const q = String(sp.s).trim()
    const types = sp.post_type === 'product' ? ['product'] : ['post', 'page']
    return searchView(q, page, types, sp.post_type === 'product')
  }

  if (path === '/' && page === 1) {
    const front = await getPostById(Number(settings['reading.page_on_front']))
    if (front) return pageView(front, '/')
  }
  if (path === '/shop/') {
    return productArchive({
      kind: 'shop', path, page, orderby: sp.orderby, query: sp.orderby ? `?orderby=${encodeURIComponent(sp.orderby)}` : '',
      bodyCls: 'archive post-type-archive post-type-archive-product woocommerce-shop woocommerce woocommerce-page',
      seo: { title: '商品 - DayinUP', description: '商品 Archive - DayinUP', robots: 'follow, index', canonical: abs('/shop/'), ogType: 'article', ogTitle: '商品 - DayinUP', ogDescription: '商品 Archive - DayinUP', ogUrl: abs('/shop/'), ogImage: PAGES.default_og_image, schema: baseSchema('/shop/', '商品 - DayinUP') },
    })
  }
  if (segs[0] === 'product' && segs.length === 2 && page === 1) {
    const v = await productView(segs[1], path)
    if (v) return v
  }
  if (segs[0] === 'product-category' || segs[0] === 'category' || segs[0] === 'tag') {
    const term = allTerms.find((t) => t.path === path)
    if (term) {
      const ids = await termWithChildren(term.id)
      const s = term.meta?.seo || {}
      const seo: Seo = {
        title: s.title || `${term.name} - DayinUP`, description: s.description, robots: s.robots || 'follow, index, max-snippet:-1, max-video-preview:-1, max-image-preview:large',
        canonical: /noindex/.test(s.robots || '') ? undefined : abs(encPath(path)), ogType: s.og_type || 'article', ogTitle: s.og_title || s.title || `${term.name} - DayinUP`,
        ogDescription: s.og_description || s.description, ogUrl: abs(encPath(path)), ogImage: s.og_image || PAGES.default_og_image, schema: absSchema(s.schema),
      }
      if (term.taxonomy === 'product_cat') {
        return productArchive({ kind: 'product_cat', path, page, termIds: ids, orderby: sp.orderby, query: sp.orderby ? `?orderby=${encodeURIComponent(sp.orderby)}` : '', bodyCls: `archive tax-product_cat term-${term.slug} term-${term.id} woocommerce woocommerce-page woocommerce-archive`, seo })
      }
      const isTag = term.taxonomy === 'post_tag'
      return postArchive({ kind: term.taxonomy, path, page, termIds: ids, bodyCls: isTag ? `archive tag tag-${term.id}` : `archive category category-${term.slug} category-${term.id}`, prefix: 'categories', seo })
    }
  }
  if (segs[0] === 'author' && segs.length === 2) {
    const a = (await getAuthors()).find((x) => x.slug === segs[1])
    if (a) {
      return postArchive({
        kind: 'author', path, page, authorId: a.id, layout: 'simple', perPage: 5, bodyCls: `archive author author-${a.slug} author-${a.id}`, prefix: 'author',
        seo: { title: `${a.name} - DayinUP`, robots: 'follow, noindex', ogType: 'profile', ogTitle: `${a.name} - DayinUP`, ogUrl: abs(path), ogImage: PAGES.default_og_image, schema: baseSchema(path, `${a.name} - DayinUP`, 'ProfilePage') },
      })
    }
  }
  if (path === '/blog/') {
    return postArchive({ kind: 'blog', path, page, bodyCls: 'blog', prefix: 'blog', seo: { title: '文章 - DayinUP', robots: 'follow, index', canonical: abs('/blog/'), ogType: 'article', ogTitle: '文章 - DayinUP', ogUrl: abs('/blog/'), ogImage: PAGES.default_og_image } })
  }
  if (path === '/cart/') {
    const pg = await getPostById(7)
    return {
      kind: 'cart', status: 200, css: [], ...shellPage(path, 7, 'wp-singular page-template-default page page-id-7 woocommerce-cart woocommerce-page', '<div id="dayinup-client"></div>'),
      seo: seoFrom(pg || {}, 'Cart', path), client: { component: 'cart', props: { emptyHtml: emptyCartHtml(pg?.content_html || '') } },
    }
  }
  if (segs[0] === 'checkout') {
    const pg = await getPostById(8)
    if (segs[1] === 'order-received' && segs[2]) {
      return {
        kind: 'order-received', status: 200, css: [], ...shellPage(path, 8, 'wp-singular page-template-default page page-id-8 woocommerce-checkout woocommerce-page woocommerce-order-received', '<div id="dayinup-client"></div>'),
        seo: { ...seoFrom(pg || {}, 'Checkout', '/checkout/'), robots: 'noindex, nofollow' }, client: { component: 'order-received', props: { orderId: segs[2], orderKey: sp.key || '' } },
      }
    }
    if (segs.length === 1) {
      return {
        kind: 'checkout', status: 200, css: [], ...shellPage(path, 8, 'wp-singular page-template-default page page-id-8 woocommerce-checkout woocommerce-page', '<div id="dayinup-client"></div>'),
        seo: seoFrom(pg || { seo: { title: 'Checkout - DayinUP' } }, 'Checkout', path), client: { component: 'checkout', props: { fields: settings['woocommerce.checkout_fields'] || {} } },
      }
    }
  }
  if (segs[0] === 'my-account') {
    const pg = await getPostById(9)
    const sub = segs.slice(1)
    return {
      kind: 'account', status: 200, css: elementorCss('/my-account/', [9]),
      ...shellPage('/my-account/', 9, 'wp-singular page-template-default page page-id-9 woocommerce-account woocommerce-page', '<div id="dayinup-client"></div>'),
      seo: { ...seoFrom(pg || {}, 'My account', '/my-account/'), ...(sub.length ? { robots: 'noindex, nofollow' } : {}) },
      client: { component: 'account', props: { sub } },
    }
  }
  if (path === '/contact/') {
    return {
      kind: 'contact', status: 200, css: [],
      ...shellPage(path, 0, 'wp-singular page-template-default page', contactHtml()),
      seo: { title: '聯絡我們 - DayinUP', description: 'DayinUP 一站式外包接案資源平台聯絡方式', robots: 'follow, index', canonical: abs('/contact/'), ogType: 'article', ogTitle: '聯絡我們 - DayinUP', ogUrl: abs('/contact/'), ogImage: PAGES.default_og_image },
    }
  }
  // pages & posts by path
  if (page === 1) {
    const post = await getPostByPath(path)
    if (post) return post.post_type === 'post' ? postView(post, path) : pageView(post, path)
  }
  return notFoundView(path)
})

async function searchView(q: string, page: number, types: string[], productSearch: boolean): Promise<View> {
  const path = '/'
  const seo: Seo = { title: `${q} - DayinUP`, robots: 'follow, noindex', ogType: 'article', ogTitle: `${q} - DayinUP`, ogUrl: abs(`/search/${encodeURIComponent(q)}/`), ogImage: PAGES.default_og_image, schema: baseSchema('/', `${q} - DayinUP`, 'SearchResultsPage') }
  // posts+pages via listPosts, products separately → merged result list
  const [posts, prods] = await Promise.all([
    productSearch ? Promise.resolve({ rows: [] as Row[], total: 0 }) : listPosts({ search: q, page: 1, perPage: 200, types }),
    listProducts({ search: q, page: 1, perPage: 200 }),
  ])
  const settings = await getSettings()
  const generated = new Set([Number(settings['reading.page_on_front']), 7, 8, 9]) // pages whose text is generated (shortcodes / blocks), not searchable in WP
  const ql = q.toLowerCase()
  const all: Row[] = [
    ...posts.rows.filter((r) => !(r.post_type === 'page' && generated.has(r.id))),
    ...prods.rows.map((p) => ({ ...p, post_type: 'product', title: p.name, excerpt_html: p.short_description_html ? '<p>' + stripTags(p.short_description_html).slice(0, 55) + '...</p>' : '' })),
  ]
  // WP orders search results by relevance: title matches first, then by date
  all.sort((a, b) => Number(String(b.title).toLowerCase().includes(ql)) - Number(String(a.title).toLowerCase().includes(ql)) || String(b.date).localeCompare(String(a.date)))
  const total = all.length
  const pages = Math.ceil(total / PER_PAGE)
  const rows = all.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const termsMap = await getPostTerms(rows.filter((r) => r.post_type === 'post').map((r) => r.id))
  const media = await getMediaMap(rows.map((r) => r.featured_media_id))
  const heroTitle = `「${q}」的搜尋結果`
  const hero = `<div class="hero-section is-width-constrained" data-type="type-1"> <header class="entry-header"> <h1 class="page-title" itemprop="headline">${esc(heroTitle)}</h1>${rows.length ? '' : '<div class="page-description ct-hidden-sm">抱歉, 沒有符合您要找的項目. 請用不同的關鍵字再試一遍.</div>'}		</header> </div>`
  const inner = rows.length
    ? `<div class="ct-container"  data-vertical-spacing="top:bottom"> <section > ${hero}<div class="entries" data-archive="default" data-layout="grid" data-cards="boxed">${rows
        .map((r) => (r.post_type === 'post' ? postCard(r, termsMap.get(r.id) || [], media.get(r.featured_media_id)) : searchCard(r, media.get(r.featured_media_id))))
        .join('')}</div> ${pagination('/', page, pages, `?s=${encodeURIComponent(q)}`, true)} </section> </div>`
    : `<div class="ct-container"  data-vertical-spacing="top:bottom"> <section class="ct-no-results"> ${hero}<div class="entry-content is-layout-flow"> ${String(SNIPPETS.search_form).replace('value=""', `value="${esc(q)}"`)} </div> </section> </div>`
  return {
    kind: 'search',
    status: 200,
    bodyClass: `search ${rows.length ? 'search-results' : 'search-no-results'} ${BASE_BODY} ct-elementor-default-template`,
    prefix: 'search',
    css: elementorCss(path, []),
    html: mainWrap(inner),
    seo,
  }
}

function emptyCartHtml(content: string): string {
  const i = content.indexOf('<div data-block-name="woocommerce/empty-cart-block"')
  if (i < 0) return ''
  const j = content.indexOf('</ul></div>', i)
  return j > 0 ? content.slice(i, j + '</ul></div>'.length) + '</div>' : ''
}

function contactHtml(): string {
  return `<div class="dayinup-contact"><h1 class="page-title">聯絡我們</h1><p>有任何合作或活動問題，歡迎留下訊息，我們會盡快回覆。也可以來信 <a href="mailto:dayin.team@gmail.com">dayin.team@gmail.com</a> 或加入 <a href="https://line.me/R/ti/p/@730wkluo" target="_blank" rel="noopener">LINE 官方帳號</a>。</p><form class="dayinup-form" data-dayinup-form="contact" action="/api/forms/contact/" method="post"><p><label for="c-name">姓名 *</label><input id="c-name" name="name" type="text" required></p><p><label for="c-email">電子郵件 *</label><input id="c-email" name="email" type="email" required></p><p><label for="c-subject">主旨</label><input id="c-subject" name="subject" type="text"></p><p><label for="c-message">訊息 *</label><textarea id="c-message" name="message" rows="6" required></textarea></p><p><button type="submit" class="wp-element-button">送出</button></p></form></div>`
}

/* ---------------------------------------------------------------- admin preview (drafts / scheduled / private) */
export async function previewView(kind: string, id: number): Promise<View | null> {
  if (kind === 'post') {
    const { data: row } = await admin().from('posts').select('*').eq('id', id).maybeSingle()
    if (!row) return null
    const path = row.path || `/?p=${row.id}`
    const v = row.post_type === 'post' ? await postView(row, path) : await pageView(row, path)
    return { ...v, seo: { ...v.seo, robots: 'noindex, nofollow', canonical: undefined } }
  }
  if (kind === 'product') {
    const { data: p } = await admin().from('products').select('*').eq('id', id).maybeSingle()
    if (!p) return null
    const path = p.path || `/product/${p.slug}/`
    if (p.status === 'publish') {
      const v = await productView(p.slug, path)
      if (v) return { ...v, seo: { ...v.seo, robots: 'noindex, nofollow' } }
    }
    const media = await getMediaMap([p.featured_media_id])
    const img = media.get(p.featured_media_id)
    const price = p.type === 'variable' && p.price_min !== p.price_max ? `NT$${Number(p.price_min || 0).toLocaleString()} – NT$${Number(p.price_max || 0).toLocaleString()}` : p.price !== null ? `NT$${Number(p.price).toLocaleString()}` : ''
    const inner = `<div class="product type-product"><div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:40px">${img ? `<img src="${esc(img.public_url)}" alt="${esc(img.alt_text || '')}" style="width:100%;height:auto">` : '<div></div>'}<div class="summary entry-summary"><h1 class="product_title entry-title">${esc(decodeEntities(p.name))}</h1><p class="price">${esc(price)}</p><div class="woocommerce-product-details__short-description">${p.short_description_html || ''}</div></div></div><div class="woocommerce-Tabs-panel">${p.description_html || ''}</div></div>`
    return {
      kind: 'product-preview', status: 200, css: [],
      ...shellPage(path, p.id, `wp-singular product-template-default single single-product postid-${p.id} woocommerce woocommerce-page`, inner),
      seo: { title: `${decodeEntities(p.name)}（預覽）- DayinUP`, robots: 'noindex, nofollow' },
    }
  }
  return null
}
