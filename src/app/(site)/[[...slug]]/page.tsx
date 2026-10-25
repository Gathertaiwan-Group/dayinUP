import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolveView } from '@/lib/views'
import { toMetadata } from '@/lib/metadata'
import Shell from '@/components/Shell'

/**
 * Public pages without a query string: ISR (rendered on first request, cached at the CDN, refreshed every 5 minutes
 * and immediately after admin / MCP writes via revalidateTag('site') / revalidatePath in refreshSite()).
 * URLs that carry a meaningful query (?s=, ?orderby=, ?add-to-cart= …) are rewritten by src/proxy.ts to /dyn/….
 */
export const revalidate = 300
export const dynamicParams = true
export function generateStaticParams(): { slug?: string[] }[] {
  return []
}

type Props = { params: Promise<{ slug?: string[] }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug = [] } = await params
  const view = await resolveView(slug, {})
  return toMetadata(view.seo)
}

export default async function Page({ params }: Props) {
  const { slug = [] } = await params
  const view = await resolveView(slug, {})
  if (view.status === 404) notFound()
  const path = '/' + slug.map((s) => decodeURIComponent(s)).join('/') + (slug.length ? '/' : '')
  return <Shell view={view} path={path} />
}
