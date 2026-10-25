import { listRecords } from "@/lib/admin/service";
import { ORDER_STATUS_LABEL } from "@/lib/admin/entities";
import { fmtDate, fmtMoney, qs } from "@/lib/admin/format";
import { countOf, sp1, type SP } from "@/lib/admin/loaders";
import { Badge, Flash, Pager } from "@/components/admin/Fields";

export default async function OrderList({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const status = sp1(sp, "status");
  const q = sp1(sp, "q");
  const offset = Number(sp1(sp, "offset")) || 0;
  const { rows, total, limit } = await listRecords("orders", {
    q,
    filters: { status: status || undefined },
    offset,
    limit: 50,
    columns: "id,status,type,billing,billing_email,total,date_created,payment_method_title,coupon_codes",
  });
  const counts = await Promise.all(Object.keys(ORDER_STATUS_LABEL).map(async (s) => [s, await countOf("orders", (qq) => qq.eq("status", s).eq("type", "shop_order"))] as const));
  const all = await countOf("orders", (qq) => qq.eq("type", "shop_order").neq("status", "trash"));
  return (
    <>
      <h1 className="adm-h1">訂單</h1>
      <Flash sp={sp} />
      <div className="adm-tabs">
        <a href="/admin/orders/" className={!status ? "on" : ""}>全部 ({all})</a>
        {counts.filter(([, n]) => n > 0).map(([s, n]) => (
          <a key={s} href={`/admin/orders/${qs({ status: s })}`} className={s === status ? "on" : ""}>
            {ORDER_STATUS_LABEL[s]} ({n})
          </a>
        ))}
      </div>
      <form className="adm-filters" method="get">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <input type="search" name="q" defaultValue={q} placeholder="訂單編號、Email、姓名、電話" />
        <button className="adm-btn" type="submit">搜尋</button>
        <a className="adm-btn" href={`/admin/orders-export/${qs({ status, q })}`}>匯出 CSV</a>
      </form>
      <table className="adm-table">
        <thead>
          <tr>
            <th>訂單</th>
            <th>日期</th>
            <th>狀態</th>
            <th>付款／運送</th>
            <th>總計</th>
          </tr>
        </thead>
        <tbody>
          {rows.filter((r) => r.type !== "shop_order_refund").map((o) => (
            <tr key={o.id}>
              <td>
                <a href={`/admin/orders/${o.id}/`}><b>#{o.id} {[o.billing?.last_name, o.billing?.first_name].filter(Boolean).join("")}</b></a>
                <div className="adm-muted">{o.billing_email} {o.billing?.phone}</div>
              </td>
              <td>{fmtDate(o.date_created)}</td>
              <td><Badge v={o.status} /> {ORDER_STATUS_LABEL[o.status]}</td>
              <td>{o.payment_method_title || "—"}<div className="adm-muted">{(o.coupon_codes || []).join(", ")}</div></td>
              <td className="num">{fmtMoney(o.total)}</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={5} className="adm-muted">沒有符合條件的訂單。</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <Pager total={total} offset={offset} limit={limit} href={(o) => `/admin/orders/${qs({ status, q, offset: o })}`} />
    </>
  );
}
