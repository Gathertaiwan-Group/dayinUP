import { notFound } from "next/navigation";
import { ENTITIES } from "@/lib/admin/entities";
import { listRecords } from "@/lib/admin/service";
import { decodeSlugSafe, fmtDate, fmtMoney, qs } from "@/lib/admin/format";
import { sp1, type SP } from "@/lib/admin/loaders";
import { Badge, Flash, Pager } from "@/components/admin/Fields";
import { ConfirmButton } from "@/components/admin/Confirm";
import { deleteRecordAction } from "../../../actions";

const HIDDEN = new Set(["posts", "products", "audit_log", "order_notes", "product_variations", "product_attributes", "menu_items", "form_submissions"]);
const TAX_LABEL: Record<string, string> = { product_cat: "商品分類", product_tag: "商品標籤", product_brand: "品牌", category: "文章分類", post_tag: "文章標籤" };

function cell(col: string, v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (/(_at$|^date|_expires)/.test(col)) return fmtDate(String(v));
  if (["total", "total_spent", "amount", "price", "regular_price", "sale_price"].includes(col)) return fmtMoney(v);
  if (["status", "stock_status"].includes(col)) return <Badge v={v} />;
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "object") return <span className="clip" style={{ display: "inline-block" }}>{JSON.stringify(v)}</span>;
  if (col === "slug" || col === "source_path" || col === "target" || col === "url" || col === "path") return decodeSlugSafe(String(v));
  return String(v);
}

export default async function EntityList({ params, searchParams }: { params: Promise<{ entity: string }>; searchParams: Promise<SP> }) {
  const { entity } = await params;
  const def = ENTITIES[entity];
  if (!def || HIDDEN.has(entity)) notFound();
  const sp = await searchParams;
  const q = sp1(sp, "q");
  const offset = Number(sp1(sp, "offset")) || 0;
  const filters: Record<string, string> = {};
  for (const f of def.filters || []) if (sp1(sp, f)) filters[f] = sp1(sp, f);
  const base = { q, ...filters };
  const here = `/admin/e/${entity}/${qs(base, { offset })}`;
  const { rows, total, limit } = await listRecords(entity, { q, filters, offset, limit: 50 });
  const title = entity === "terms" && filters.taxonomy ? TAX_LABEL[filters.taxonomy] || def.label : def.label;
  const newHref = `/admin/e/${entity}/new/${entity === "terms" && filters.taxonomy ? `?taxonomy=${filters.taxonomy}` : ""}`;
  return (
    <>
      <h1 className="adm-h1">
        {title}
        {!def.readonly ? <a className="adm-btn" href={newHref}>新增</a> : null}
      </h1>
      <Flash sp={sp} />
      <form className="adm-filters" method="get">
        {Object.entries(filters).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {def.search.length ? <input type="search" name="q" defaultValue={q} placeholder="搜尋" /> : null}
        {def.search.length ? <button className="adm-btn" type="submit">搜尋</button> : null}
        {entity === "redirects" ? <span className="adm-muted">轉址規則由前台 proxy 讀取（最多 5 分鐘快取）。</span> : null}
        {["customers", "coupons"].includes(entity) && !total ? <span className="adm-muted">舊站私有資料待第三階段由資料庫備份匯入。</span> : null}
      </form>
      <table className="adm-table">
        <thead>
          <tr>
            {def.list.map((c) => <th key={c}>{def.fields.find((f) => f.name === c)?.label || c}</th>)}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const id = String(r[def.pk]);
            return (
              <tr key={id}>
                {def.list.map((c, i) => (
                  <td key={c} className={i === 1 ? "" : undefined}>
                    {i === 0 || c === "name" || c === "title" || c === "code" || c === "email" || c === "source_path" ? <a href={`/admin/e/${entity}/${encodeURIComponent(id)}/`}>{cell(c, r[c])}</a> : cell(c, r[c])}
                  </td>
                ))}
                <td className="num">
                  {!def.readonly ? (
                    <form action={deleteRecordAction.bind(null, entity, id, here)}>
                      <ConfirmButton className="adm-btn sm danger" message="確定刪除？">刪除</ConfirmButton>
                    </form>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {!rows.length ? (
            <tr><td colSpan={def.list.length + 1} className="adm-muted">沒有資料</td></tr>
          ) : null}
        </tbody>
      </table>
      <Pager total={total} offset={offset} limit={limit} href={(o) => `/admin/e/${entity}/${qs(base, { offset: o })}`} />
    </>
  );
}
