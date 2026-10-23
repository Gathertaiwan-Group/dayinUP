import type { Metadata } from 'next'
import { notFoundView } from '@/lib/views'
import { toMetadata } from '@/lib/metadata'
import { connection } from 'next/server'
import Shell from '@/components/Shell'

export const metadata: Metadata = toMetadata(notFoundView('/').seo)

export default async function NotFound() {
  await connection()
  return <Shell view={notFoundView('/')} path="/404/" />
}
