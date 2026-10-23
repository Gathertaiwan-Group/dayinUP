/* eslint-disable @typescript-eslint/no-explicit-any */
export type CartLine = {
  key: number; product_id: number; variation_id: number | null; name: string; variation: Record<string, string>
  quantity: number; unit_price: number; regular_price: number; line_total: number; image: string | null; path: string; in_stock: boolean; sold_individually: boolean; max_qty: number | null
}
export type CartSummary = { id: string | null; items: CartLine[]; count: number; subtotal: number; discount: number; total: number; coupons: { code: string; amount: number }[] }

export function fmt(n: number | string | null | undefined) {
  return String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
export function Money({ v }: { v: number | string | null | undefined }) {
  return (
    <span className="woocommerce-Price-amount amount">
      <bdi>
        <span className="woocommerce-Price-currencySymbol" translate="no" dir="auto">NT$</span>
        {fmt(v)}
      </bdi>
    </span>
  )
}
export async function call(url: string, method = 'GET', body?: any): Promise<any> {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  return { ...j, __status: r.status }
}
export function syncBadge(cart: { count: number; total: number } | undefined) {
  const w = window as any
  if (cart && w.dayinup?.updateCartBadge) w.dayinup.updateCartBadge(cart)
}
export const STATUS_LABEL: Record<string, string> = {
  pending: '待付款', processing: '處理中', 'on-hold': '保留', completed: '已完成', cancelled: '已取消', refunded: '已退費', failed: '失敗', 'checkout-draft': '草稿',
}
