import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolveView } from '@/lib/views'
import { toMetadata } from '@/lib/metadata'
import Shell from '@/components/Shell'
import { publishDue } from '@/lib/schedule'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

function flat(sp: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const o: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(sp)) o[k] = Array.isArray(v) ? v[0] : v
  return o
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  await publishDue()
  const { slug = [] } = await params
  const view = await resolveView(slug, flat(await searchParams))
  return toMetadata(view.seo)
}

export default async function Page({ params, searchParams }: Props) {
  await publishDue()
  const { slug = [] } = await params
  const view = await resolveView(slug, flat(await searchParams))
  if (view.status === 404) notFound()
  const path = '/' + slug.map((s) => decodeURIComponent(s)).join('/') + (slug.length ? '/' : '')
  return <Shell view={view} path={path} />
}
