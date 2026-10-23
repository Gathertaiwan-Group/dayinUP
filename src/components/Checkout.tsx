'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react'
import { call, Money, type CartSummary } from './shop'

type Field = { label: string; required?: boolean; hidden?: boolean; index?: number; autocomplete?: string; type?: string; optionalLabel?: string }

const COUNTRIES: [string, string][] = [
  ['TW', '台灣'], ['HK', '香港'], ['MO', '澳門'], ['CN', '中國'], ['JP', '日本'], ['KR', '南韓'], ['SG', '新加坡'], ['MY', '馬來西亞'], ['US', '美國'], ['GB', '英國'], ['AU', '澳洲'], ['CA', '加拿大'],
]
const TW_STATES = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '嘉義市', '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣']

export default function Checkout({ fields }: { fields: Record<string, Field> }) {
  const [cart, setCart] = useState<CartSummary | null>(null)
  const [vals, setVals] = useState<Record<string, string>>({ country: 'TW' })
  const [note, setNote] = useState('')
  const [hasNote, setHasNote] = useState(false)
  const [err, setErr] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    call('/api/cart/').then((r) => setCart(r.cart))
    call('/api/account/profile/').then((r) => {
      if (r.user) setVals((v) => ({ ...v, email: r.user.email || '', first_name: r.user.first_name || '', last_name: r.user.last_name || '', ...(r.user.billing || {}) }))
    })
  }, [])

  const ordered = useMemo(
    () =>
      Object.entries(fields)
        .filter(([, f]) => !f.hidden)
        .sort((a, b) => (a[1].index ?? 0) - (b[1].index ?? 0)),
    [fields],
  )

  if (!cart) return <div className="wp-block-woocommerce-checkout alignwide is-loading" style={{ minHeight: 300 }} aria-busy="true" />
  if (!cart.items.length) {
    // WooCommerce redirects an empty checkout to the cart page
    if (typeof window !== 'undefined') window.location.replace('/cart/')
    return (
      <div className="wp-block-woocommerce-checkout alignwide">
        <div className="wc-block-components-notice-banner is-info" role="status">
          <div className="wc-block-components-notice-banner__content">
            您的購物車目前是空的。 <a href="/shop/" className="button wc-backward">返回商店</a>
          </div>
        </div>
      </div>
    )
  }

  const input = (k: string, f: Field) => {
    const id = `billing-${k}`
    const label = f.required ? f.label : f.optionalLabel || `${f.label} (選填)`
    if (k === 'country') {
      return (
        <div className="wc-block-components-country-input wc-block-components-combobox is-active" key={k}>
          <div className="wc-block-components-combobox-control">
            <label htmlFor={id} className="components-base-control__label">{label}</label>
            <select id={id} value={vals.country || 'TW'} onChange={(e) => setVals({ ...vals, country: e.target.value })} autoComplete="country" required className="dayinup-select">
              {COUNTRIES.map(([c, n]) => <option value={c} key={c}>{n}</option>)}
            </select>
          </div>
        </div>
      )
    }
    if (k === 'state' && (vals.country || 'TW') === 'TW') {
      return (
        <div className="wc-block-components-state-input wc-block-components-combobox is-active" key={k}>
          <label htmlFor={id} className="components-base-control__label">{label}</label>
          <select id={id} value={vals.state || ''} onChange={(e) => setVals({ ...vals, state: e.target.value })} required={!!f.required} className="dayinup-select">
            <option value="">請選擇縣市</option>
            {TW_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )
    }
    return (
      <div className={`wc-block-components-text-input wc-block-components-address-form__${k}${vals[k] ? ' is-active' : ''}`} key={k}>
        <input
          type={f.type || (k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text')}
          id={id}
          autoComplete={f.autocomplete}
          aria-label={label}
          required={!!f.required}
          value={vals[k] || ''}
          onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
        />
        <label htmlFor={id}>{label}</label>
      </div>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr([])
    const w = window as any
    const r = await call('/api/checkout/', 'POST', { billing: vals, customer_note: hasNote ? note : '', attribution: w.dayinup?.attribution?.() || {} })
    setBusy(false)
    if (r.ok && r.redirect) {
      w.dayinup?.updateCartBadge?.({ count: 0, total: 0 })
      window.location.href = r.redirect
    } else {
      setErr(r.errors || [r.error || '結帳失敗，請稍後再試。'])
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const contact = ordered.filter(([k]) => k === 'email')
  const address = ordered.filter(([k]) => k !== 'email')

  return (
    <div className="wp-block-woocommerce-checkout alignwide wc-block-checkout is-large">
      {err.length > 0 && (
        <div className="wc-block-components-notice-banner is-error" role="alert">
          <div className="wc-block-components-notice-banner__content">
            {err.map((x, i) => <div key={i}>{x}</div>)}
          </div>
        </div>
      )}
      <form className="wc-block-components-form wc-block-checkout__form dayinup-checkout" onSubmit={submit} noValidate={false}>
        <div className="wc-block-components-sidebar-layout wc-block-checkout is-large">
          <div className="wc-block-components-main wc-block-checkout__main">
            <fieldset className="wc-block-checkout__contact-fields wp-block-woocommerce-checkout-contact-information-block wc-block-components-checkout-step">
              <legend className="screen-reader-text">聯絡資訊</legend>
              <div className="wc-block-components-checkout-step__heading"><h2 className="wc-block-components-title wc-block-components-checkout-step__title">聯絡資訊</h2></div>
              <div className="wc-block-components-checkout-step__container">
                <p className="wc-block-components-checkout-step__description">我們會使用這個電子郵件地址傳送訂單詳細資料和更新給你。</p>
                <div className="wc-block-components-checkout-step__content">{contact.map(([k, f]) => input(k, f))}</div>
              </div>
            </fieldset>
            <fieldset className="wc-block-checkout__billing-fields wp-block-woocommerce-checkout-billing-address-block wc-block-components-checkout-step">
              <legend className="screen-reader-text">帳單地址</legend>
              <div className="wc-block-components-checkout-step__heading"><h2 className="wc-block-components-title wc-block-components-checkout-step__title">帳單地址</h2></div>
              <div className="wc-block-components-checkout-step__container">
                <p className="wc-block-components-checkout-step__description">輸入與你付款方式相符的帳單地址。</p>
                <div className="wc-block-components-checkout-step__content wc-block-components-address-form">{address.map(([k, f]) => input(k, f))}</div>
              </div>
            </fieldset>
            <fieldset className="wc-block-checkout__payment-method wp-block-woocommerce-checkout-payment-block wc-block-components-checkout-step">
              <legend className="screen-reader-text">付款選項</legend>
              <div className="wc-block-components-checkout-step__heading"><h2 className="wc-block-components-title wc-block-components-checkout-step__title">付款選項</h2></div>
              <div className="wc-block-components-checkout-step__container">
                <div className="wc-block-components-radio-control-accordion-option wc-block-components-radio-control-accordion-option--checked-option-highlighted">
                  <label className="wc-block-components-radio-control__option wc-block-components-radio-control__option-checked">
                    <input type="radio" className="wc-block-components-radio-control__input" checked readOnly name="radio-control-wc-payment-method-options" value="pending" />
                    <div className="wc-block-components-radio-control__option-layout">
                      <span className="wc-block-components-radio-control__label">送出訂單後付款（待付款）</span>
                    </div>
                  </label>
                  <div className="wc-block-components-radio-control-accordion-content">
                    <p>訂單送出後狀態為「待付款」，我們會再以電子郵件提供付款方式。目前網站未串接線上刷卡。</p>
                  </div>
                </div>
              </div>
            </fieldset>
            <div className="wc-block-checkout__add-note">
              <div className="wc-block-components-checkbox">
                <label htmlFor="checkbox-control-note">
                  <input id="checkbox-control-note" className="wc-block-components-checkbox__input" type="checkbox" checked={hasNote} onChange={(e) => setHasNote(e.target.checked)} />
                  <span className="wc-block-components-checkbox__label">新增訂單備註</span>
                </label>
              </div>
              {hasNote && (
                <div className="wc-block-components-textarea">
                  <textarea aria-label="關於訂單的備註" placeholder="關於訂單的備註，例如特殊交貨說明。" value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ width: '100%' }} />
                </div>
              )}
            </div>
            <div className="wc-block-checkout__terms wc-block-checkout__terms--with-separator">
              <span className="wc-block-components-checkbox-label">送出訂單即表示你同意本商店的條款與條件及隱私權政策。</span>
            </div>
            <div className="wc-block-checkout__actions">
              <div className="wc-block-checkout__actions_row">
                <a href="/cart/" className="wc-block-components-checkout-return-to-cart-button">返回購物車</a>
                <button type="submit" className="wc-block-components-button wp-element-button wc-block-components-checkout-place-order-button contained" disabled={busy}>
                  <span className="wc-block-components-button__text">{busy ? '處理中…' : '下單購買'}</span>
                </button>
              </div>
            </div>
          </div>
          <div className="wc-block-components-sidebar wc-block-checkout__sidebar">
            <div className="wp-block-woocommerce-checkout-order-summary-block">
              <div className="wc-block-components-checkout-order-summary__title"><p className="wc-block-components-checkout-order-summary__title-text">訂單摘要</p></div>
              <div className="wc-block-components-order-summary">
                {cart.items.map((i) => (
                  <div className="wc-block-components-order-summary-item" key={i.key}>
                    <div className="wc-block-components-order-summary-item__image">
                      <div className="wc-block-components-order-summary-item__quantity"><span aria-hidden="true">{i.quantity}</span></div>
                      {i.image && <img src={i.image} alt={i.name} width={48} height={48} style={{ objectFit: 'cover' }} />}
                    </div>
                    <div className="wc-block-components-order-summary-item__description">
                      <h3 className="wc-block-components-product-name">{i.name}</h3>
                      <span className="wc-block-components-order-summary-item__individual-prices price wc-block-components-product-price"><Money v={i.unit_price} /></span>
                      {Object.entries(i.variation).map(([k, v]) => (
                        <div className="wc-block-components-product-metadata" key={k}><span className="wc-block-components-product-details__name">{k}:</span> {v}</div>
                      ))}
                    </div>
                    <span className="wc-block-components-order-summary-item__total-price"><Money v={i.line_total} /></span>
                  </div>
                ))}
              </div>
              <div className="wc-block-components-totals-wrapper">
                <div className="wc-block-components-totals-item"><span className="wc-block-components-totals-item__label">小計</span><span className="wc-block-components-totals-item__value"><Money v={cart.subtotal} /></span></div>
                {cart.coupons.map((c) => (
                  <div className="wc-block-components-totals-item wc-block-components-totals-discount" key={c.code}><span className="wc-block-components-totals-item__label">優惠券：{c.code}</span><span className="wc-block-components-totals-item__value">-<Money v={c.amount} /></span></div>
                ))}
              </div>
              <div className="wc-block-components-totals-wrapper">
                <div className="wc-block-components-totals-item wc-block-components-totals-footer-item"><span className="wc-block-components-totals-item__label">總計</span><div className="wc-block-components-totals-item__value"><Money v={cart.total} /></div></div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
