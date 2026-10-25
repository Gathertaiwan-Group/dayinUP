import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { cartHasItems } from '@/lib/cart'
import { resolveView } from '@/lib/views'
import { toMetadata } from '@/lib/metadata'
import Shell from '@/components/Shell'

/**
 * Same views as ../[[...slug]] but for URLs with a query string that changes the output (search, sorting, add-to-cart…).
 * Only reachable through the rewrite in src/proxy.ts (direct /dyn/… requests 404 there). Data reads still hit the
 * 5-minute data cache (src/lib/supabase.ts), so these renders do not query Supabase every time either.
 */
type Props = { params: Promise<{ slug?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

function flat(sp: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const o: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(sp)) o[k] = Array.isArray(v) ? v[0] : v
  return o
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug = [] } = await params
  const view = await resolveView(slug, flat(await searchParams))
  return toMetadata(view.seo)
}

export default async function Page({ params, searchParams }: Props) {
  const { slug = [] } = await params
  const view = await resolveView(slug, flat(await searchParams))
  if (view.status === 404) notFound()
  if (view.kind === 'checkout' && !(await cartHasItems())) redirect('/cart/')
  const path = '/' + slug.map((s) => decodeURIComponent(s)).join('/') + (slug.length ? '/' : '')
  return <Shell view={view} path={path} />
}
