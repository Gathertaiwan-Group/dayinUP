import { serviceDb } from "@/lib/supabase";
import { POST_STATUS_LABEL } from "@/lib/admin/entities";
import { decodeSlugSafe, fmtMoney, qs } from "@/lib/admin/format";
import { allTerms, countOf, sp1, type SP } from "@/lib/admin/loaders";
import { Badge, Flash } from "@/components/admin/Fields";
import { ConfirmButton } from "@/components/admin/Confirm";
import { deleteRecordAction, restoreAction, saveProductOrderAction } from "../../actions";

export default async function ProductList({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const status = sp1(sp, "status");
  const q = sp1(sp, "q").replace(/[,()*\\%_"]/g, " ").trim();
  const cat = Number(sp1(sp, "cat")) || 0;
  const stock = sp1(sp, "stock");
  const base = { status, q, cat: cat || "", stock };
  const here = `/admin/products/${qs(base)}`;
  const db = serviceDb();
  let query = db
    .from("products")
    .select("id,name,slug,sku,status,type,price,price_min,price_max,regular_price,sale_price,on_sale,stock_status,stock_quantity,manage_stock,menu_order,featured,path,date,media:featured_media_id(public_url),product_terms(term_id)")
    .order("date", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });
  if (status) query = query.eq("status", status);
  else query = query.neq("status", "trash");
  if (stock) query = query.eq("stock_status", stock);
  if (q) query = query.or(`name.ilike.*${q}*,sku.ilike.*${q}*,slug.ilike.*${q}*`);
  const [{ data }, cats, counts] = await Promise.all([
    query.limit(500),
    allTerms(["product_cat"]),
    Promise.all(["", "publish", "draft", "pending", "future", "private", "trash"].map(async (s) => [s, await countOf("products", (qq) => (s ? qq.eq("status", s) : qq.neq("status", "trash")))] as const)),
  ]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const rows = (data || []).filter((p: any) => !cat || (p.product_terms || []).some((t: any) => t.term_id === cat));
  return (
    <>
      <h1 className="adm-h1">
        商品 <a className="adm-btn" href="/admin/products/new/">新增商品</a>
      </h1>
      <Flash sp={sp} />
      <div className="adm-tabs">
        {counts.map(([s, n]) => (
          <a key={s} href={`/admin/products/${qs({ status: s })}`} className={s === status ? "on" : ""}>
            {s ? POST_STATUS_LABEL[s] : "全部"} ({n})
          </a>
        ))}
      </div>
      <form className="adm-filters" method="get">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <input type="search" name="q" defaultValue={sp1(sp, "q")} placeholder="搜尋商品名稱／SKU" />
        <select name="cat" defaultValue={cat ? String(cat) : ""}>
          <option value="">所有分類</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}（{c.count}）</option>
          ))}
        </select>
        <select name="stock" defaultValue={stock}>
          <option value="">庫存狀態</option>
          <option value="instock">有庫存</option>
          <option value="outofstock">缺貨</option>
          <option value="onbackorder">預購</option>
        </select>
        <button className="adm-btn" type="submit">篩選</button>
      </form>
      <form action={saveProductOrderAction}>
        <input type="hidden" name="returnTo" value={here} />
        <p className="adm-muted">
          列表依發布日期新到舊。前台商品彙整頁依 WooCommerce 預設排序（自訂排序 menu_order，再依日期）；修改數字後按「儲存排序」。
          <button className="adm-btn sm" type="submit" style={{ marginLeft: 8 }}>儲存排序</button>
        </p>
        <table className="adm-table">
          <thead>
            <tr>
              <th></th>
              <th>名稱</th>
              <th>SKU</th>
              <th>庫存</th>
              <th>價格</th>
              <th>分類</th>
              <th>狀態</th>
              <th>自訂排序</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p: any) => (
              <tr key={p.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <td>{p.media?.public_url ? <img className="thumb" src={p.media.public_url} alt="" /> : <span className="thumb" />}</td>
                <td>
                  <a href={`/admin/products/${p.id}/`}><b>{p.name}</b></a>
                  {p.featured ? " ★" : ""}
                  <div className="adm-muted">#{p.id}・{decodeSlugSafe(p.slug)}</div>
                </td>
                <td>{p.sku || "—"}</td>
                <td><Badge v={p.stock_status} /> {p.manage_stock ? p.stock_quantity : ""}</td>
                <td className="num">
                  {p.on_sale ? <><s className="adm-muted">{fmtMoney(p.regular_price)}</s><br /></> : null}
                  {p.type === "variable" && p.price_min !== p.price_max ? `${fmtMoney(p.price_min)}–${fmtMoney(p.price_max)}` : fmtMoney(p.price)}
                  {p.type === "variable" ? <div className="adm-muted">票種變體</div> : null}
                </td>
                <td>{(p.product_terms || []).map((t: any) => catName.get(t.term_id)).filter(Boolean).join("、") || "—"}</td>
                <td><Badge v={p.status} /></td>
                <td>
                  <input type="hidden" name={`orig_${p.id}`} value={p.menu_order} />
                  <input type="number" name={`order_${p.id}`} defaultValue={p.menu_order} style={{ width: 70 }} aria-label="自訂排序" />
                </td>
                <td className="num">
                  <div className="adm-row" style={{ justifyContent: "flex-end" }}>
                    {p.status === "publish" ? <a className="adm-btn sm" href={p.path || `/product/${p.slug}/`} target="_blank" rel="noreferrer">檢視</a> : <a className="adm-btn sm" href={`/admin-preview/product/${p.id}/`} target="_blank" rel="noreferrer">預覽</a>}
                    {p.status === "trash" ? (
                      <>
                        <button className="adm-btn sm" type="submit" formAction={restoreAction.bind(null, "products", String(p.id), here)}>還原</button>
                        <ConfirmButton className="adm-btn sm danger" message="永久刪除後無法復原，確定？" name="force" value="1" formAction={deleteRecordAction.bind(null, "products", String(p.id), here)}>
                          永久刪除
                        </ConfirmButton>
                      </>
                    ) : (
                      <ConfirmButton className="adm-btn sm danger" message="移到垃圾桶？" formAction={deleteRecordAction.bind(null, "products", String(p.id), here)}>
                        垃圾桶
                      </ConfirmButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={9} className="adm-muted">沒有商品</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="adm-mt">
          <button className="adm-btn" type="submit">儲存排序</button> <span className="adm-muted">共 {rows.length} 件</span>
        </p>
      </form>
    </>
  );
}

