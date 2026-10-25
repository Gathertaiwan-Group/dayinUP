import { requireAdmin } from "@/lib/admin/guard";
import { serviceDb } from "@/lib/supabase";
import { countOf } from "@/lib/admin/loaders";
import { ORDER_STATUS_LABEL } from "@/lib/admin/entities";
import { fmtDate, fmtMoney } from "@/lib/admin/format";
import { Badge } from "@/components/admin/Fields";

export default async function Dashboard() {
  await requireAdmin();
  const db = serviceDb();
  const [products, drafts, pages, posts, orders, pending, processing, customers, coupons, media, subs, redirects] = await Promise.all([
    countOf("products", (q) => q.eq("status", "publish")),
    countOf("products", (q) => q.in("status", ["draft", "pending", "future"])),
    countOf("posts", (q) => q.eq("post_type", "page").neq("status", "trash")),
    countOf("posts", (q) => q.eq("post_type", "post").neq("status", "trash")),
    countOf("orders", (q) => q.eq("type", "shop_order")),
    countOf("orders", (q) => q.eq("status", "pending")),
    countOf("orders", (q) => q.eq("status", "processing")),
    countOf("customers", (q) => q.is("meta->>site_admin", null)),
    countOf("coupons"),
    countOf("media"),
    countOf("form_submissions", (q) => q.eq("status", "unread")),
    countOf("redirects"),
  ]);
  const [{ data: recentOrders }, { data: recentAudit }, { data: lowStock }] = await Promise.all([
    db.from("orders").select("id,status,total,billing,date_created").eq("type", "shop_order").order("date_created", { ascending: false }).limit(8),
    db.from("audit_log").select("id,created_at,via,actor,action,entity_type,entity_id").order("created_at", { ascending: false }).limit(10),
    db.from("products").select("id,name,stock_quantity,stock_status").eq("status", "publish").or("stock_status.eq.outofstock,and(manage_stock.eq.true,stock_quantity.lte.5)").order("stock_quantity").limit(10),
  ]);
  const stat = (label: string, n: number, href: string) => (
    <a className="adm-stat" href={href}>
      <b>{n}</b>
      {label}
    </a>
  );
  return (
    <>
      <h1 className="adm-h1">控制台</h1>
      <div className="adm-stats">
        {stat("上架商品", products, "/admin/products/?status=publish")}
        {stat("草稿／待審／排程商品", drafts, "/admin/products/?status=draft")}
        {stat("訂單", orders, "/admin/orders/")}
        {stat("待付款訂單", pending, "/admin/orders/?status=pending")}
        {stat("處理中訂單", processing, "/admin/orders/?status=processing")}
        {stat("顧客", customers, "/admin/e/customers/")}
        {stat("頁面", pages, "/admin/content/?type=page")}
        {stat("文章", posts, "/admin/content/?type=post")}
        {stat("優惠券", coupons, "/admin/e/coupons/")}
        {stat("媒體", media, "/admin/media/")}
        {stat("未讀表單提交", subs, "/admin/forms/")}
        {stat("轉址規則", redirects, "/admin/e/redirects/")}
      </div>
      <div className="adm-cols2">
        <div className="adm-card">
          <h2 className="adm-h2">最新訂單</h2>
          {recentOrders?.length ? (
            <table className="adm-table">
              <tbody>
                {recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td><a href={`/admin/orders/${o.id}/`}>#{o.id}</a> {[o.billing?.last_name, o.billing?.first_name].filter(Boolean).join("")}</td>
                    <td><Badge v={o.status} /> {ORDER_STATUS_LABEL[o.status]}</td>
                    <td className="num">{fmtMoney(o.total)}</td>
                    <td>{fmtDate(o.date_created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="adm-muted">尚無訂單。</p>
          )}
          <h2 className="adm-h2 adm-mt">庫存警示</h2>
          {lowStock?.length ? (
            <ul>
              {lowStock.map((p) => (
                <li key={p.id}>
                  <a href={`/admin/products/${p.id}/`}>{p.name}</a> — <Badge v={p.stock_status} /> {p.stock_quantity ?? ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="adm-muted">沒有低庫存商品。</p>
          )}
        </div>
        <div className="adm-card">
          <h2 className="adm-h2">最近活動</h2>
          <table className="adm-table">
            <tbody>
              {(recentAudit || []).map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.created_at)}</td>
                  <td>{r.via}・{r.actor}</td>
                  <td>{r.action} {r.entity_type} #{r.entity_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p><a href="/admin/audit/">全部稽核紀錄 →</a></p>
        </div>
      </div>
    </>
  );
}
