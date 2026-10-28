'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'
import { call, Money, STATUS_LABEL } from './shop'

export default function OrderReceived({ orderId, orderKey = '' }: { orderId: string; orderKey?: string }) {
  const [order, setOrder] = useState<any>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('key') || orderKey
    call(`/api/orders/${encodeURIComponent(orderId)}/?key=${encodeURIComponent(k)}`).then((r) => (r.ok ? setOrder(r.order) : setErr(r.error || '找不到訂單。')))
  }, [orderId, orderKey])
  if (err) return <div className="woocommerce"><div className="woocommerce-error" role="alert">{err}</div></div>
  if (!order) return <div className="woocommerce is-loading" style={{ minHeight: 200 }} />
  const date = new Date(order.date_created).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })
  return (
    <div className="woocommerce">
      <div className="woocommerce-order">
        {notice(order)}
        {order.payment?.account || order.payment?.code_no ? (
          <ul className="woocommerce-order-overview order_details">
            {order.payment.bank_code && <li>銀行代碼： <strong>{order.payment.bank_code}</strong></li>}
            {order.payment.account && <li>轉帳帳號： <strong>{order.payment.account}</strong></li>}
            {order.payment.code_no && <li>超商繳費代碼： <strong>{order.payment.code_no}</strong></li>}
            {order.payment.expire_date && <li>繳費期限： <strong>{[order.payment.expire_date, order.payment.expire_time].filter(Boolean).join(' ')}</strong></li>}
          </ul>
        ) : null}
        <ul className="woocommerce-order-overview woocommerce-thankyou-order-details order_details">
          <li className="woocommerce-order-overview__order order">訂單編號： <strong>{order.id}</strong></li>
          <li className="woocommerce-order-overview__date date">日期： <strong>{date}</strong></li>
          {order.billing?.email && <li className="woocommerce-order-overview__email email">電子郵件： <strong>{order.billing.email}</strong></li>}
          <li className="woocommerce-order-overview__total total">總計： <strong><Money v={order.total} /></strong></li>
          <li className="woocommerce-order-overview__payment-method method">付款方式： <strong>{order.payment_method_title}</strong></li>
          <li className="woocommerce-order-overview__status">狀態： <strong>{STATUS_LABEL[order.status] || order.status}</strong></li>
        </ul>
        <section className="woocommerce-order-details">
          <h2 className="woocommerce-order-details__title">訂單詳細資料</h2>
          <table className="woocommerce-table woocommerce-table--order-details shop_table order_details">
            <thead><tr><th className="woocommerce-table__product-name product-name">商品</th><th className="woocommerce-table__product-table product-total">總計</th></tr></thead>
            <tbody>
              {order.items.filter((i: any) => i.item_type === 'line_item').map((i: any, n: number) => (
                <tr className="woocommerce-table__line-item order_item" key={n}>
                  <td className="woocommerce-table__product-name product-name">{i.name} <strong className="product-quantity">×&nbsp;{i.quantity}</strong></td>
                  <td className="woocommerce-table__product-total product-total"><Money v={i.total} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th scope="row">小計：</th><td><Money v={order.subtotal} /></td></tr>
              {Number(order.discount_total) > 0 && <tr><th scope="row">折扣：</th><td>-<Money v={order.discount_total} /></td></tr>}
              <tr><th scope="row">付款方式：</th><td>{order.payment_method_title}</td></tr>
              <tr><th scope="row">總計：</th><td><Money v={order.total} /></td></tr>
              {order.customer_note && <tr><th>備註：</th><td>{order.customer_note}</td></tr>}
            </tfoot>
          </table>
        </section>
      </div>
    </div>
  )
}

function notice(order: any) {
  const nw = String(order.payment_method || '').startsWith('ry_newebpay')
  if (!nw) return <p className="woocommerce-notice woocommerce-notice--success woocommerce-thankyou-order-received">謝謝您，我們已收到您的訂單。訂單目前為「待付款」，我們會再與您聯繫付款方式。</p>
  if (order.status === 'failed' || (order.pay_url && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('nwp') === 'fail'))
    return (
      <p className="woocommerce-notice woocommerce-notice--error woocommerce-thankyou-order-failed">
        很遺憾，您的付款未成功{order.payment?.message ? `（${order.payment.message}）` : ''}，訂單尚未完成。
        {order.pay_url && <> <a href={order.pay_url} className="button pay">重新付款</a></>}
      </p>
    )
  if (order.status === 'pending')
    return (
      <p className="woocommerce-notice woocommerce-thankyou-order-received">
        訂單已建立，正在等待藍新金流付款結果。若您已完成付款，請稍後重新整理本頁。
        {order.pay_url && <> <a href={order.pay_url} className="button pay">前往付款</a></>}
      </p>
    )
  if (order.status === 'on-hold') return <p className="woocommerce-notice woocommerce-notice--success woocommerce-thankyou-order-received">謝謝您，我們已收到您的訂單，請於期限內依下列資訊完成繳費。</p>
  if (order.status === 'cancelled') return <p className="woocommerce-notice woocommerce-notice--error">此訂單已取消（付款期限已過）。</p>
  return <p className="woocommerce-notice woocommerce-notice--success woocommerce-thankyou-order-received">謝謝您，我們已收到您的訂單。</p>
}
