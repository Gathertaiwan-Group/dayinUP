import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getAdmin } from '@/lib/admin/guard'
import { previewView } from '@/lib/views'
import { toMetadata } from '@/lib/metadata'
import Shell from '@/components/Shell'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ kind: string; id: string }> }

/** Admin-only preview of drafts / scheduled / private posts, pages and products, rendered with the public theme. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kind, id } = await params
  if (!(await getAdmin())) return { robots: { index: false, follow: false } }
  const v = await previewView(kind, Number(id))
  return v ? { ...toMetadata(v.seo), robots: { index: false, follow: false } } : { robots: { index: false, follow: false } }
}

export default async function Preview({ params }: Props) {
  const { kind, id } = await params
  if (!(await getAdmin())) redirect('/admin/login/')
  if (!/^\d+$/.test(id)) notFound()
  const view = await previewView(kind, Number(id))
  if (!view) notFound()
  return (
    <>
      <div style={{ position: 'fixed', zIndex: 99999, bottom: 16, right: 16, background: '#1d2327', color: '#fff', padding: '8px 14px', borderRadius: 6, fontSize: 13 }}>
        預覽模式（僅管理員可見）・<a href={kind === 'product' ? `/admin/products/${id}/` : `/admin/content/${id}/`} style={{ color: '#72aee6' }}>回到編輯</a>
      </div>
      <Shell view={view} path={view.kind === 'product-preview' ? `/product/` : '/'} />
    </>
  )
}
