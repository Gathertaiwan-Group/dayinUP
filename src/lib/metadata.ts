import type { Metadata } from 'next'
import type { Seo } from './views'

export function toMetadata(seo: Seo): Metadata {
  const other: Record<string, string> = { ...(seo.extra || {}) }
  return {
    title: { absolute: seo.title },
    description: seo.description || undefined,
    robots: seo.robots,
    alternates: seo.canonical ? { canonical: seo.canonical } : undefined,
    openGraph: {
      locale: 'zh_TW',
      // og:type "product" and article:* times are emitted as <meta property> by <Shell> (Next only knows website/article/profile)
      ...(seo.ogType === 'product' ? {} : { type: (seo.ogType === 'profile' ? 'profile' : seo.ogType === 'website' ? 'website' : 'article') as 'article' }),
      title: seo.ogTitle || seo.title,
      description: seo.ogDescription || undefined,
      url: seo.ogUrl || seo.canonical,
      siteName: 'DayinSHOP',
      images: seo.ogImage ? [{ url: seo.ogImage, alt: seo.ogTitle || seo.title }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: seo.ogTitle || seo.title,
      description: seo.ogDescription || undefined,
      images: seo.ogImage ? [seo.ogImage] : undefined,
    },
    other,
  }
}
