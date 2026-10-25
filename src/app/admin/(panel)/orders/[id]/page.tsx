import { requireAdmin } from "@/lib/admin/guard";
import { notFound } from "next/navigation";
import { getOrderFull } from "@/lib/admin/service";
import { ENTITIES, ORDER_STATUS_LABEL } from "@/lib/admin/entities";
import { fmtDate, fmtMoney } from "@/lib/admin/format";
import type { SP } from "@/lib/admin/loaders";
import { Badge, FieldInput, FieldSet, Flash } from "@/components/admin/Fields";
import { orderDetailsAction, orderNoteAction, orderStatusAction } from "../../../actions";

const ADDRESS_KEYS: [string, string][] = [
  ["last_name", "姓氏"],
  ["first_name", "名字"],
  ["company", "公司"],
  ["phone", "電話"],
  ["email", "Email"],
  ["country", "國家"],
  ["postcode", "郵遞區號"],
  ["state", "縣市"],
  ["city", "鄉鎮市區"],
  ["address_1", "地址"],
  ["address_2", "地址 2"],
];

export default async function OrderView({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const o = await getOrderFull(Number(id));
  if (!o) notFound();
  const F = ENTITIES.orders.fields;
  const other = F.filter((f) => ["customer_note", "payment_method", "payment_method_title", "transaction_id"].includes(f.name));
  const addr = (kind: "billing" | "shipping") =>
    ADDRESS_KEYS.filter(([k]) => kind === "billing" || !["email"].includes(k)).map(([k, label]) => (
      <div className="adm-field" key={`${kind}_${k}`}>
        <label htmlFor={`${kind}__${k}`}>{label}</label>
        <input id={`${kind}__${k}`} name={`${kind}__${k}`} defaultValue={String(o[kind]?.[k] ?? "")} />
      </div>
    ));
  const lines = o.items.filter((i: any) => i.item_type === "line_item");
  const extra = o.items.filter((i: any) => i.item_type !== "line_item");
  return (
    <>
      <h1 className="adm-h1">
        訂單 #{o.id} <Badge v={o.status} /> {ORDER_STATUS_LABEL[o.status]}
        <a className="adm-btn sm" href="/admin/orders/">回列表</a>
      </h1>
      <Flash sp={sp} />
      <div className="adm-grid">
        <div>
          <div className="adm-card">
            <p className="adm-muted">
              建立於 {fmtDate(o.date_created)}・來源 {o.created_via || "—"}
              {o.date_paid ? `・付款 ${fmtDate(o.date_paid)}` : ""}
              {o.date_completed ? `・完成 ${fmtDate(o.date_completed)}` : ""}
              {o.customer_id ? <>・顧客 <a href={`/admin/e/customers/${o.customer_id}/`}>#{o.customer_id}</a></> : "・訪客"}
            </p>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>商品</th>
                  <th>單價</th>
                  <th>數量</th>
                  <th>小計</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((i: any) => (
                  <tr key={i.id}>
                    <td>
                      {i.product_id ? <a href={`/admin/products/${i.product_id}/`}>{i.name}</a> : i.name}
                      {i.sku ? <div className="adm-muted">SKU：{i.sku}</div> : null}
                      {i.meta && Object.keys(i.meta).length ? <div className="adm-muted">{Object.entries(i.meta).filter(([k]) => !k.startsWith("_")).map(([k, v]) => `${k}：${typeof v === "object" ? JSON.stringify(v) : v}`).join("；")}</div> : null}
                    </td>
                    <td className="num">{fmtMoney(i.unit_price ?? (i.quantity ? Number(i.subtotal) / i.quantity : i.subtotal))}</td>
                    <td className="num">× {i.quantity}</td>
                    <td className="num">{fmtMoney(i.total)}</td>
                  </tr>
                ))}
                {extra.map((i: any) => (
                  <tr key={i.id}>
                    <td colSpan={3}>{({ shipping: "運費", fee: "手續費", coupon: "優惠券", tax: "稅" } as Record<string, string>)[i.item_type] || i.item_type}：{i.name}</td>
                    <td className="num">{fmtMoney(i.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th colSpan={3} style={{ textAlign: "right" }}>商品小計</th><td className="num">{fmtMoney(o.subtotal)}</td></tr>
                {Number(o.discount_total) ? <tr><th colSpan={3} style={{ textAlign: "right" }}>折扣</th><td className="num">-{fmtMoney(o.discount_total)}</td></tr> : null}
                <tr><th colSpan={3} style={{ textAlign: "right" }}>運費</th><td className="num">{fmtMoney(o.shipping_total)}</td></tr>
                {Number(o.fee_total) ? <tr><th colSpan={3} style={{ textAlign: "right" }}>手續費</th><td className="num">{fmtMoney(o.fee_total)}</td></tr> : null}
                <tr><th colSpan={3} style={{ textAlign: "right" }}>訂單總計</th><td className="num"><b>{fmtMoney(o.total)}</b></td></tr>
              </tfoot>
            </table>
            {o.refunds.length ? <p className="adm-muted">退款：{o.refunds.map((r: any) => `${fmtMoney(r.total)}（${fmtDate(r.date_created)}）`).join("、")}</p> : null}
          </div>
          <form action={orderDetailsAction.bind(null, id)} className="adm-card">
            <h2 className="adm-h2">帳單與收件資料</h2>
            <FieldSet fields={[]} row={null} extraNames={other.map((f) => f.name)} />
            <div className="adm-cols2">
              <div>
                <h3 className="adm-h2">帳單</h3>
                {addr("billing")}
              </div>
              <div>
                <h3 className="adm-h2">收件</h3>
                {addr("shipping")}
              </div>
            </div>
            {other.map((f) => <FieldInput key={f.name} f={f} row={o} />)}
            {o.meta && Object.keys(o.meta).length ? (
              <details>
                <summary>其他資料（meta）</summary>
                <pre className="adm-json">{JSON.stringify(o.meta, null, 2)}</pre>
              </details>
            ) : null}
            <button className="adm-btn pri" type="submit">儲存資料</button>
          </form>
        </div>
        <aside>
          <form action={orderStatusAction.bind(null, id)} className="adm-card">
            <h2 className="adm-h2">訂單狀態</h2>
            <div className="adm-field">
              <select name="status" defaultValue={o.status} aria-label="訂單狀態">
                {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}（{k}）</option>
                ))}
              </select>
            </div>
            <div className="adm-field">
              <label htmlFor="note">附註（選填，會寫入訂單備註）</label>
              <textarea id="note" name="note" className="plain" rows={2} />
            </div>
            <button className="adm-btn pri" type="submit">更新狀態</button>
            <p className="adm-muted">本站未串接金流（舊站為藍新 NewebPay）：訂單由前台建立為「待付款」，收款後請手動改為「處理中」。</p>
          </form>
          <div className="adm-card">
            <h2 className="adm-h2">訂單備註</h2>
            <form action={orderNoteAction.bind(null, id)}>
              <textarea name="note" className="plain" rows={2} aria-label="新增備註" required />
              <div className="adm-row adm-mt">
                <label className="adm-check"><input type="checkbox" name="is_customer_note" /> 給顧客的備註</label>
                <button className="adm-btn sm" type="submit">新增</button>
              </div>
            </form>
            <ul style={{ paddingLeft: 18 }}>
              {o.notes.map((n: any) => (
                <li key={n.id} className="adm-mt">
                  {n.note}
                  <div className="adm-muted">{fmtDate(n.created_at)}・{n.added_by || "系統"}{n.is_customer_note ? "・給顧客" : ""}</div>
                </li>
              ))}
            </ul>
          </div>
          {o.attribution && Object.keys(o.attribution).length ? (
            <div className="adm-card">
              <h2 className="adm-h2">訂單來源</h2>
              <pre className="adm-json">{JSON.stringify(o.attribution, null, 2)}</pre>
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}

