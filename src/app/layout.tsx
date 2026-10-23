import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { headers } from 'next/headers'
import { getSettings } from '@/lib/data'
import pagesJson from '@/generated/pages.json'
import './globals.css'

const GLOBAL_CSS = (pagesJson as { global_css: string[] }).global_css
const SITE_URL = (process.env.SITE_URL || 'https://dayinup.com').replace(/\/$/, '')
const ICON = 'https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/site-dayinup/uploads/2025/03/cropped-LOGO-LOGO-c9bbf8f8.webp'
const TRACKING = process.env.DISABLE_TRACKING !== '1'
// defaults = codes observed on the old site; editable in /admin/settings/ (setting tracking.codes)
const DEFAULT_CODES = { gtag_id: 'GT-PZM4W5BH', amplitude_key: '7808d6f18b3194b76773fa8c3ed07a0b', cloudflare_token: '3a49ae5422f84f388d0a7fb7aa849581', hubspot: true, custom_head_html: '' }
const ID = /^[\w-]+$/

async function trackingCodes(): Promise<typeof DEFAULT_CODES> {
  try {
    const s = await getSettings()
    return { ...DEFAULT_CODES, ...(s['tracking.codes'] || {}) }
  } catch {
    return DEFAULT_CODES
  }
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  icons: { icon: [{ url: ICON, sizes: '32x32' }, { url: ICON, sizes: '192x192' }], apple: ICON },
  other: { 'msapplication-TileImage': ICON },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#F9FAFB',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // /admin uses its own layout and styles (flag set by src/proxy.ts)
  if ((await headers()).get('x-dayinup-admin')) {
    return (
      <html lang="zh-TW" suppressHydrationWarning>
        <body>{children}</body>
      </html>
    )
  }
  const t = await trackingCodes()
  const gtag = ID.test(t.gtag_id || '') ? t.gtag_id : ''
  const amp = ID.test(t.amplitude_key || '') ? t.amplitude_key : ''
  const cf = ID.test(t.cloudflare_token || '') ? t.cloudflare_token : ''
  return (
    <html lang="zh-TW" dir="ltr" data-link="type-2">
      <head>
        {GLOBAL_CSS.map((href) => (
          // eslint-disable-next-line @next/next/no-css-tags
          <link key={href} rel="stylesheet" href={href} media="all" />
        ))}
        <link rel="stylesheet" href="/wp-css/inline.css" />
        <link rel="stylesheet" href="/wp-css/dayinup.css" />
      </head>
      <body className="stk--is-blocksy-theme">
        {children}
        <Script src="/wp-css/site.js" strategy="afterInteractive" />
        {TRACKING && (
          <>
            {gtag ? (
              <>
                <Script id="google_gtagjs-js" src={`https://www.googletagmanager.com/gtag/js?id=${gtag}`} strategy="afterInteractive" />
                <Script id="google_gtagjs-js-after" strategy="afterInteractive">{`window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}
gtag("set","linker",{"domains":["dayinup.com"]});
gtag("js", new Date());
gtag("set", "developer_id.dZTNiMT", true);
gtag("config", "${gtag}");`}</Script>
              </>
            ) : null}
            {amp ? (
              <>
                <Script id="aampli_plg_scr_web_experiment-js" src={`https://cdn.amplitude.com/script/${amp}.experiment.js`} strategy="afterInteractive" />
                <Script id="aampli_plg_scr_setup-js" src="https://cdn.amplitude.com/libs/analytics-browser-2.11.9-min.js.gz" strategy="afterInteractive" />
                <Script id="aampli_plg_scr_session_replay-js" src="https://cdn.amplitude.com/libs/plugin-session-replay-browser-1.8.2-min.js.gz" strategy="afterInteractive" />
                <Script id="aampli_plg_scr_configure" strategy="lazyOnload">{`(function(){var k="${amp}";function go(){if(!window.amplitude){return setTimeout(go,300)}try{if(window.sessionReplay&&window.sessionReplay.plugin){window.amplitude.add(window.sessionReplay.plugin({sampleRate:1}))}window.amplitude.init(k,{fetchRemoteConfig:true,autocapture:true,serverZone:"US"})}catch(e){}}go()})();`}</Script>
              </>
            ) : null}
            {t.hubspot !== false ? <Script id="hsq-set-content-id" strategy="afterInteractive">{`var _hsq = window._hsq = window._hsq || []; _hsq.push(["setContentType", "standard-page"]);`}</Script> : null}
            {cf ? <Script id="cf-web-analytics" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon={JSON.stringify({ token: cf, spa: true })} strategy="afterInteractive" /> : null}
            {t.custom_head_html ? <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: String(t.custom_head_html) }} /> : null}
          </>
        )}
      </body>
    </html>
  )
}
