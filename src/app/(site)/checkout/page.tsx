import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { resolveView } from '@/lib/views'
import { toMetadata } from '@/lib/metadata'
import { cartHasItems } from '@/lib/cart'
import Shell from '@/components/Shell'

/**
 * /checkout/ reads the visitor's cart on the server: like WooCommerce, an empty cart redirects to /cart/.
 * (Per-visitor → dynamic; /checkout/order-received/… is still served by the [[...slug]] catch-all.)
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return toMetadata((await resolveView(['checkout'], {})).seo)
}

export default async function Page() {
  if (!(await cartHasItems())) redirect('/cart/')
  const view = await resolveView(['checkout'], {})
  return <Shell view={view} path="/checkout/" />
}
