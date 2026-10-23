import { productEntries, urlset, xml } from '@/lib/sitemap'
export const dynamic = 'force-dynamic'
export async function GET() { return xml(urlset(await productEntries())) }
