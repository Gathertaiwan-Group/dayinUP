import type { Metadata } from 'next'
import { notFoundView } from '@/lib/views'
import { toMetadata } from '@/lib/metadata'
import Shell from '@/components/Shell'

export const metadata: Metadata = toMetadata(notFoundView('/').seo)

export default async function NotFound() {
  return <Shell view={notFoundView('/')} path="/404/" />
}
