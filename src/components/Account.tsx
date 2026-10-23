'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'
import { call, Money, STATUS_LABEL } from './shop'
import OrderReceived from './OrderReceived'

const NAV: [string, string][] = [
  ['', '控制台'],
  ['orders', '訂單'],
  ['edit-address', '地址'],
  ['edit-account', '帳號詳細資料'],
  ['customer-logout', '登出'],
]

export default function Account({ sub = [] }: { sub?: string[] }) {
  const [user, setUser] = useState<any>(undefined)
  useEffect(() => {
    call('/api/account/profile/').then((r) => setUser(r.user || null))
  }, [])
  const ep = sub[0] || ''

  if (user === undefined) return <div className="woocommerce is-loading" style={{ minHeight: 300 }} aria-busy="true" />
  if (!user) {
    if (ep === 'lost-password') return <LostPassword />
    return <Login />
  }
  if (ep === 'customer-logout') {
    call('/api/auth/logout/', 'POST').then(() => (window.location.href = '/my-account/'))
    return <div className="woocommerce"><p>正在登出…</p></div>
  }
  return (
    <div className="woocommerce">
      <nav className="woocommerce-MyAccount-navigation" aria-label="帳號頁面">
        <ul>
          {NAV.map(([k, label]) => (
            <li key={k} className={`woocommerce-MyAccount-navigation-link woocommerce-MyAccount-navigation-link--${k || 'dashboard'}${ep === k ? ' is-active' : ''}`}>
              <a href={`/my-account/${k ? k + '/' : ''}`} aria-current={ep === k ? 'page' : undefined}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="woocommerce-MyAccount-content">
        <div className="woocommerce-notices-wrapper" />
        {ep === '' && (
          <>
            <p>
              <strong>{user.display_name || user.username || user.email}</strong> 你好 (不是 <strong>{user.display_name || user.username}</strong>？<a href="/my-account/customer-logout/">登出</a>)
            </p>
            <p>
              你可以在帳號控制台中查看<a href="/my-account/orders/">最近的訂單</a>，管理<a href="/my-account/edit-address/">帳單地址</a>，以及<a href="/my-account/edit-account/">編輯密碼和帳號詳細資料</a>。
            </p>
          </>
        )}
        {ep === 'orders' && <Orders />}
        {ep === 'view-order' && sub[1] && <OrderReceived orderId={sub[1]} />}
        {ep === 'edit-address' && <EditAddress user={user} />}
        {ep === 'edit-account' && <EditAccount user={user} />}
      </div>
    </div>
  )
}

function Login() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [show, setShow] = useState(false)
  return (
    <div className="woocommerce ct-woo-unauthorized">
      <div className="woocommerce-notices-wrapper">{msg && <div className={msg.ok ? 'woocommerce-message' : 'woocommerce-error'} role="alert">{msg.text}</div>}</div>
      <h2>登入</h2>
      <form
        className="woocommerce-form woocommerce-form-login login"
        method="post"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = e.currentTarget as any
          const r = await call('/api/auth/login/', 'POST', { login: f.username.value, password: f.password.value, remember: f.rememberme.checked })
          if (r.ok) window.location.reload()
          else setMsg({ ok: false, text: r.error || '登入失敗' })
        }}
      >
        <p className="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
          <label htmlFor="username">使用者名稱 或 電子郵件&nbsp;<span className="required" aria-hidden="true">*</span><span className="screen-reader-text">必填</span></label>
          <br />
          <input type="text" className="woocommerce-Input woocommerce-Input--text input-text" name="username" id="username" autoComplete="username" required aria-required="true" />
        </p>
        <p className="woocommerce-form-row woocommerce-form-row--wide form-row form-row-wide">
          <label htmlFor="password">密碼&nbsp;<span className="required" aria-hidden="true">*</span><span className="screen-reader-text">必填</span></label>
          <br />
          <span className="password-input">
            <input className="woocommerce-Input woocommerce-Input--text input-text" type={show ? 'text' : 'password'} name="password" id="password" autoComplete="current-password" required aria-required="true" />
            <button type="button" className={`show-password-input${show ? ' display-password' : ''}`} aria-label={show ? '隱藏密碼' : '顯示密碼'} onClick={() => setShow(!show)} />
          </span>
        </p>
        <p className="form-row">
          <label className="woocommerce-form__label woocommerce-form__label-for-checkbox woocommerce-form-login__rememberme">
            <br />
            <input className="woocommerce-form__input woocommerce-form__input-checkbox" name="rememberme" type="checkbox" id="rememberme" value="forever" /> <span>保持登入</span>
            <br />
          </label>
          <br />
          <button type="submit" className="woocommerce-button button woocommerce-form-login__submit" name="login" value="登入">登入</button>
        </p>
        <p className="woocommerce-LostPassword lost_password">
          <a href="/my-account/lost-password/">忘記密碼？</a>
        </p>
      </form>
    </div>
  )
}

function LostPassword() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  return (
    <div className="woocommerce">
      <div className="woocommerce-notices-wrapper">{msg && <div className={msg.ok ? 'woocommerce-message' : 'woocommerce-error'} role="alert">{msg.text}</div>}</div>
      <form
        method="post"
        className="woocommerce-ResetPassword lost_reset_password"
        onSubmit={async (e) => {
          e.preventDefault()
          const f = e.currentTarget as any
          const r = await call('/api/auth/lost-password/', 'POST', { user_login: f.user_login.value })
          setMsg({ ok: !!r.ok, text: r.message || r.error })
        }}
      >
        <p>忘記密碼了嗎？請輸入使用者名稱或電子郵件地址，你會收到透過電子郵件寄送的連結，以便建立新密碼。</p>
        <p className="woocommerce-form-row woocommerce-form-row--first form-row form-row-first">
          <label htmlFor="user_login">使用者名稱或電子郵件&nbsp;<span className="required" aria-hidden="true">*</span></label>
          <input className="woocommerce-Input woocommerce-Input--text input-text" type="text" name="user_login" id="user_login" autoComplete="username" required />
        </p>
        <div className="clear" />
        <p className="woocommerce-form-row form-row">
          <button type="submit" className="woocommerce-Button button" value="重設密碼">重設密碼</button>
        </p>
      </form>
    </div>
  )
}

function Orders() {
  const [orders, setOrders] = useState<any[] | null>(null)
  useEffect(() => {
    call('/api/account/orders/').then((r) => setOrders(r.orders || []))
  }, [])
  if (!orders) return <p>載入中…</p>
  if (!orders.length)
    return (
      <div className="woocommerce-info">
        尚未建立任何訂單。 <a className="woocommerce-Button wc-forward button" href="/shop/">瀏覽產品</a>
      </div>
    )
  return (
    <table className="woocommerce-orders-table woocommerce-MyAccount-orders shop_table shop_table_responsive my_account_orders account-orders-table">
      <thead>
        <tr>
          <th className="woocommerce-orders-table__header"><span className="nobr">訂單</span></th>
          <th className="woocommerce-orders-table__header"><span className="nobr">日期</span></th>
          <th className="woocommerce-orders-table__header"><span className="nobr">狀態</span></th>
          <th className="woocommerce-orders-table__header"><span className="nobr">總計</span></th>
          <th className="woocommerce-orders-table__header"><span className="nobr">動作</span></th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => {
          const n = (o.order_items || []).filter((i: any) => i.item_type === 'line_item').reduce((s: number, i: any) => s + i.quantity, 0)
          return (
            <tr className={`woocommerce-orders-table__row woocommerce-orders-table__row--status-${o.status} order`} key={o.id}>
              <th className="woocommerce-orders-table__cell" scope="row" data-title="訂單"><a href={`/my-account/view-order/${o.id}/`}>#{o.id}</a></th>
              <td className="woocommerce-orders-table__cell" data-title="日期"><time dateTime={o.date_created}>{new Date(o.date_created).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })}</time></td>
              <td className="woocommerce-orders-table__cell" data-title="狀態">{STATUS_LABEL[o.status] || o.status}</td>
              <td className="woocommerce-orders-table__cell" data-title="總計"><Money v={o.total} /> ，共 {n} 項</td>
              <td className="woocommerce-orders-table__cell" data-title="動作"><a href={`/my-account/view-order/${o.id}/`} className="woocommerce-button button view">檢視</a></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function EditAddress({ user }: { user: any }) {
  const [b, setB] = useState<Record<string, string>>(user.billing || {})
  const [msg, setMsg] = useState('')
  const f = (k: string, label: string, type = 'text') => (
    <p className="form-row form-row-wide" key={k}>
      <label htmlFor={`billing_${k}`}>{label}</label>
      <input className="input-text" type={type} id={`billing_${k}`} value={b[k] || ''} onChange={(e) => setB({ ...b, [k]: e.target.value })} />
    </p>
  )
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const r = await call('/api/auth/update/', 'POST', { billing: b })
        setMsg(r.message || r.error)
      }}
    >
      {msg && <div className="woocommerce-message" role="alert">{msg}</div>}
      <h2>帳單地址</h2>
      <div className="woocommerce-address-fields">
        {f('last_name', '姓氏')}
        {f('first_name', '名字')}
        {f('company', '公司 (選填)')}
        {f('address_1', '地址')}
        {f('city', '城市')}
        {f('state', '縣/市')}
        {f('postcode', '郵遞區號')}
        {f('phone', '聯絡電話', 'tel')}
        {f('email', '電子郵件地址', 'email')}
      </div>
      <p><button type="submit" className="button" name="save_address">儲存地址</button></p>
    </form>
  )
}

function EditAccount({ user }: { user: any }) {
  const [v, setV] = useState<Record<string, string>>({ first_name: user.first_name || '', last_name: user.last_name || '', display_name: user.display_name || '' })
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  return (
    <form
      className="woocommerce-EditAccountForm edit-account"
      onSubmit={async (e) => {
        e.preventDefault()
        const r = await call('/api/auth/update/', 'POST', v)
        setMsg({ ok: !!r.ok, t: r.message || r.error })
      }}
    >
      {msg && <div className={msg.ok ? 'woocommerce-message' : 'woocommerce-error'} role="alert">{msg.t}</div>}
      <p className="woocommerce-form-row form-row form-row-first"><label htmlFor="account_first_name">名字</label><input className="input-text" id="account_first_name" value={v.first_name} onChange={(e) => setV({ ...v, first_name: e.target.value })} /></p>
      <p className="woocommerce-form-row form-row form-row-last"><label htmlFor="account_last_name">姓氏</label><input className="input-text" id="account_last_name" value={v.last_name} onChange={(e) => setV({ ...v, last_name: e.target.value })} /></p>
      <p className="woocommerce-form-row form-row form-row-wide"><label htmlFor="account_display_name">顯示名稱</label><input className="input-text" id="account_display_name" value={v.display_name} onChange={(e) => setV({ ...v, display_name: e.target.value })} /></p>
      <p className="woocommerce-form-row form-row form-row-wide"><label>電子郵件地址</label><input className="input-text" value={user.email} disabled readOnly /></p>
      <fieldset>
        <legend>變更密碼</legend>
        <p className="woocommerce-form-row form-row form-row-wide"><label htmlFor="password_1">新密碼（若不變更請留空）</label><input type="password" className="input-text" id="password_1" autoComplete="new-password" onChange={(e) => setV({ ...v, password_1: e.target.value })} /></p>
        <p className="woocommerce-form-row form-row form-row-wide"><label htmlFor="password_2">確認新密碼</label><input type="password" className="input-text" id="password_2" autoComplete="new-password" onChange={(e) => setV({ ...v, password_2: e.target.value })} /></p>
      </fieldset>
      <p><button type="submit" className="woocommerce-Button button" name="save_account_details">儲存變更</button></p>
    </form>
  )
}
