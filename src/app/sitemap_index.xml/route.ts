import { postEntries, productEntries, xml } from '@/lib/sitemap'
import { SITE_URL } from '@/lib/supabase'
export const dynamic = 'force-dynamic'
export async function GET() {
  const [posts, pages, products] = await Promise.all([postEntries('post'), postEntries('page'), productEntries()])
  const last = (e: { lastmod?: string | null }[]) => e.map((x) => x.lastmod).filter(Boolean).sort().pop()
  const item = (n: string, lm?: string | null) => `\t<sitemap>\n\t\t<loc>${SITE_URL}/${n}</loc>\n${lm ? `\t\t<lastmod>${new Date(lm).toISOString().replace('.000Z', '+00:00')}</lastmod>\n` : ''}\t</sitemap>`
  const body = [item('post-sitemap.xml', last(posts)), item('page-sitemap.xml', last(pages)), item('product-sitemap.xml', last(products)), item('category-sitemap.xml', last(posts))].join('\n')
  return xml(`<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>`)
}
