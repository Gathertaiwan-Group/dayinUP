import { SITE_URL } from '@/lib/supabase'
export const dynamic = 'force-dynamic'
export function GET() {
  const body = `User-agent: *\nDisallow: /wp-admin/\nDisallow: /api/\nAllow: /wp-admin/admin-ajax.php\n\nSitemap: ${SITE_URL}/sitemap_index.xml\n`
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=UTF-8' } })
}
