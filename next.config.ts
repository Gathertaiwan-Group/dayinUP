import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  trailingSlash: true,
  // the /foo -> /foo/ redirect is done in src/proxy.ts instead, so POST /api/mcp (no slash) is not 308'd
  skipTrailingSlashRedirect: true,
  serverExternalPackages: ['sharp'],
  experimental: {
    serverActions: { bodySizeLimit: '4mb' }, // admin media upload (Vercel request limit 4.5MB)
  },
  poweredByHeader: false,
  images: { unoptimized: true },
  async headers() {
    return [
      { source: '/wp-content/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      { source: '/wp-css/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }] },
    ]
  },
}

export default nextConfig
