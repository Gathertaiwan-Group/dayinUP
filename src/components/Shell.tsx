import { buildChrome } from '@/lib/shell'
import type { View } from '@/lib/views'
import ClientMount from './ClientMount'

function iso(d: string) {
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

export default async function Shell({ view, path }: { view: View; path: string }) {
  const chrome = await buildChrome(path, view.active || [])
  const ld = view.seo.schema ? JSON.stringify(view.seo.schema).replace(/</g, '\\u003c') : null
  return (
    <>
      {view.css.map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="default" />
      ))}
      {view.seo.ogType === 'product' && <meta property="og:type" content="product" />}
      {view.seo.modified && <meta property="og:updated_time" content={iso(view.seo.modified)} />}
      {view.seo.ogType === 'article' && view.seo.published && <meta property="article:published_time" content={iso(view.seo.published)} />}
      {view.seo.ogType === 'article' && view.seo.modified && <meta property="article:modified_time" content={iso(view.seo.modified)} />}
      {view.seo.next && <link rel="next" href={view.seo.next} />}
      {view.seo.prev && <link rel="prev" href={view.seo.prev} />}
      {ld && <script type="application/ld+json" className="rank-math-schema" dangerouslySetInnerHTML={{ __html: ld }} />}
      <div
        id="dayinup-body"
        className={view.bodyClass}
        data-link="type-2"
        data-prefix={view.prefix}
        data-header="type-1:sticky"
        data-footer="type-1"
        data-view={view.kind}
      >
        <a className="skip-link screen-reader-text" href="#main">跳至主要內容</a>
        <div dangerouslySetInnerHTML={{ __html: view.floatingBar ? chrome.drawerStart.replace(/<\/div>\s*$/, view.floatingBar + '</div>').replace('data-location="start"', 'data-location="start" data-floating-bar="no"') : chrome.drawerStart }} style={{ display: 'contents' }} />
        <div id="main-container">
          <div dangerouslySetInnerHTML={{ __html: chrome.header }} style={{ display: 'contents' }} />
          {view.client ? (
            <main id="main" className="site-main hfeed">
              <div className="ct-container-full" data-content="normal">
                <article className="page type-page status-publish hentry">
                  <div className="entry-content is-layout-constrained">
                    <ClientMount component={view.client.component} props={view.client.props || {}} />
                  </div>
                </article>
              </div>
            </main>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: view.html }} style={{ display: 'contents' }} />
          )}
          <div dangerouslySetInnerHTML={{ __html: chrome.footer }} style={{ display: 'contents' }} />
        </div>
        <div dangerouslySetInnerHTML={{ __html: chrome.drawerEnd }} style={{ display: 'contents' }} />
      </div>
    </>
  )
}
