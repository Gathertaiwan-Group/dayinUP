'use client'
import { useEffect, useState } from 'react'
import { call, Money, syncBadge, type CartSummary } from './shop'

export default function Cart({ emptyHtml }: { emptyHtml?: string }) {
  const [cart, setCart] = useState<CartSummary | null>(null)
  const [err, setErr] = useState('')
  const [coupon, setCoupon] = useState('')
  const [showCoupon, setShowCoupon] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    call('/api/cart/').then((r) => setCart(r.cart))
  }, [])

  async function act(method: string, body: object) {
    setBusy(true)
    setErr('')
    const r = await call('/api/cart/', method, body)
    setBusy(false)
    if (r.cart) {
      setCart(r.cart)
      syncBadge({ count: r.cart.count, total: r.cart.total })
    }
    if (!r.ok) setErr(r.error || '發生錯誤')
    return r
  }

  if (!cart) return <div className="wp-block-woocommerce-cart alignwide is-loading" style={{ minHeight: 300 }} aria-busy="true" />

  if (!cart.items.length) {
    return (
      <div className="wp-block-woocommerce-cart alignwide">
        <div className="wp-block-woocommerce-empty-cart-block" dangerouslySetInnerHTML={{ __html: (emptyHtml || '').replace(/^<div[^>]*>/, '').replace(/<\/div>\s*$/, '') }} />
      </div>
    )
  }

  return (
    <div className={`wp-block-woocommerce-cart alignwide is-large${busy ? ' is-busy' : ''}`}>
      {err && (
        <div className="wc-block-components-notice-banner is-error" role="alert">
          <div className="wc-block-components-notice-banner__content">{err}</div>
        </div>
      )}
      <div className="wc-block-components-sidebar-layout wc-block-cart wp-block-woocommerce-filled-cart-block is-large">
        <div className="wc-block-components-main wc-block-cart__main wp-block-woocommerce-cart-items-block">
          <table className="wc-block-cart-items wp-block-woocommerce-cart-line-items-block" tabIndex={-1}>
            <thead>
              <tr className="wc-block-cart-items__header">
                <th className="wc-block-cart-items__header-image"><span>商品</span></th>
                <th className="wc-block-cart-items__header-product"><span>詳細資料</span></th>
                <th className="wc-block-cart-items__header-total"><span>總計</span></th>
              </tr>
            </thead>
            <tbody>
              {cart.items.map((i) => (
                <tr className="wc-block-cart-items__row" key={i.key} data-cart-item={i.key}>
                  <td className="wc-block-cart-item__image" aria-hidden="true">
                    <a href={i.path} tabIndex={-1}>
                      {i.image && <img src={i.image} alt={i.name} width={120} style={{ aspectRatio: '16/9', objectFit: 'cover' }} />}
                    </a>
                  </td>
                  <td className="wc-block-cart-item__product">
                    <div className="wc-block-cart-item__wrap">
                      <a className="wc-block-components-product-name" href={i.path}>{i.name}</a>
                      <div className="wc-block-cart-item__prices">
                        <span className="price wc-block-components-product-price">
                          {i.regular_price > i.unit_price && (
                            <del className="wc-block-components-product-price__regular"><Money v={i.regular_price} /></del>
                          )}{' '}
                          <span className="wc-block-components-product-price__value is-discounted"><Money v={i.unit_price} /></span>
                        </span>
                      </div>
                      {Object.keys(i.variation).length > 0 && (
                        <div className="wc-block-components-product-metadata">
                          <ul className="wc-block-components-product-details">
                            {Object.entries(i.variation).map(([k, v]) => (
                              <li key={k} className="wc-block-components-product-details__票種">
                                <span className="wc-block-components-product-details__name">{k}:</span>{' '}
                                <span className="wc-block-components-product-details__value">{v}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {!i.in_stock && <p className="wc-block-components-product-low-stock-badge">已售完</p>}
                      <div className="wc-block-cart-item__quantity">
                        {!i.sold_individually && (
                          <div className="wc-block-components-quantity-selector">
                            <input
                              className="wc-block-components-quantity-selector__input"
                              type="number"
                              step={1}
                              min={1}
                              max={i.max_qty || undefined}
                              aria-label={`${i.name} 的數量`}
                              value={i.quantity}
                              onChange={(e) => act('PATCH', { key: i.key, quantity: Number(e.target.value) })}
                            />
                            <button aria-label={`減少 ${i.name} 的數量`} className="wc-block-components-quantity-selector__button wc-block-components-quantity-selector__button--minus" disabled={i.quantity <= 1 || busy} onClick={() => act('PATCH', { key: i.key, quantity: i.quantity - 1 })}>－</button>
                            <button aria-label={`增加 ${i.name} 的數量`} className="wc-block-components-quantity-selector__button wc-block-components-quantity-selector__button--plus" disabled={busy || (!!i.max_qty && i.quantity >= i.max_qty)} onClick={() => act('PATCH', { key: i.key, quantity: i.quantity + 1 })}>＋</button>
                          </div>
                        )}
                        <button className="wc-block-cart-item__remove-link" aria-label={`從購物車移除 ${i.name}`} onClick={() => act('DELETE', { key: i.key })}>移除項目</button>
                      </div>
                    </div>
                  </td>
                  <td className="wc-block-cart-item__total">
                    <div className="wc-block-cart-item__total-price-and-sale-badge-wrapper">
                      <span className="price wc-block-components-product-price"><Money v={i.line_total} /></span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="wc-block-components-sidebar wc-block-cart__sidebar wp-block-woocommerce-cart-totals-block">
          <div className="wp-block-woocommerce-cart-order-summary-block">
            <div className="wc-block-components-totals-wrapper">
              <h2 className="wc-block-cart__totals-title">購物車總計</h2>
            </div>
            <div className="wc-block-components-totals-wrapper">
              <div className="wc-block-components-totals-coupon">
                {!showCoupon ? (
                  <button className="wc-block-components-totals-coupon-link" onClick={() => setShowCoupon(true)} style={{ background: 'none', border: 0, padding: 0, color: 'var(--theme-palette-color-2)', cursor: 'pointer' }}>
                    新增優惠券
                  </button>
                ) : (
                  <form
                    className="wc-block-components-totals-coupon__form"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      const r = await act('PATCH', { coupon })
                      if (r.ok) setCoupon('')
                    }}
                    style={{ display: 'flex', gap: 8 }}
                  >
                    <input className="wc-block-components-text-input" aria-label="輸入代碼" placeholder="輸入代碼" value={coupon} onChange={(e) => setCoupon(e.target.value)} style={{ flex: 1 }} />
                    <button type="submit" className="wc-block-components-button wp-element-button wc-block-components-totals-coupon__button contained" disabled={!coupon || busy}>
                      套用
                    </button>
                  </form>
                )}
              </div>
            </div>
            <div className="wc-block-components-totals-wrapper">
              <div className="wc-block-components-totals-item">
                <span className="wc-block-components-totals-item__label">小計</span>
                <span className="wc-block-components-totals-item__value"><Money v={cart.subtotal} /></span>
              </div>
              {cart.coupons.map((c) => (
                <div className="wc-block-components-totals-item wc-block-components-totals-discount" key={c.code}>
                  <span className="wc-block-components-totals-item__label">
                    優惠券：{c.code}{' '}
                    <button onClick={() => act('PATCH', { remove_coupon: c.code })} style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 12 }} aria-label={`移除優惠券 ${c.code}`}>
                      [移除]
                    </button>
                  </span>
                  <span className="wc-block-components-totals-item__value">-<Money v={c.amount} /></span>
                </div>
              ))}
            </div>
            <div className="wc-block-components-totals-wrapper">
              <div className="wc-block-components-totals-item wc-block-components-totals-footer-item">
                <span className="wc-block-components-totals-item__label">預估總計</span>
                <div className="wc-block-components-totals-item__value">
                  <span className="wc-block-formatted-money-amount wc-block-components-formatted-money-amount wc-block-components-totals-footer-item-tax-value"><Money v={cart.total} /></span>
                </div>
              </div>
            </div>
          </div>
          <div className="wc-block-cart__submit wp-block-woocommerce-proceed-to-checkout-block">
            <div className="wc-block-cart__submit-container">
              <a href="/checkout/" className="wc-block-components-button wp-element-button wc-block-cart__submit-button contained">
                <span className="wc-block-components-button__text">前往結帳</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
