import { notFound } from "next/navigation";
import { ENTITIES } from "@/lib/admin/entities";
import { getRecord } from "@/lib/admin/service";
import { serviceDb } from "@/lib/supabase";
import { decodeSlugSafe, fmtDate, fmtMoney } from "@/lib/admin/format";
import { allTerms, mediaMap, sp1, type SP } from "@/lib/admin/loaders";
import { FieldSet, Flash } from "@/components/admin/Fields";
import { ConfirmButton } from "@/components/admin/Confirm";
import { deleteRecordAction, saveRecordAction } from "../../../../actions";

export default async function EntityEdit({ params, searchParams }: { params: Promise<{ entity: string; id: string }>; searchParams: Promise<SP> }) {
  const { entity, id: rawId } = await params;
  const def = ENTITIES[entity];
  if (!def || ["posts", "products", "audit_log"].includes(entity)) notFound();
  const sp = await searchParams;
  const id = decodeURIComponent(rawId);
  const isNew = id === "new";
  if (isNew && def.readonly) notFound();
  const row = isNew ? null : await getRecord(entity, id);
  if (!isNew && !row) notFound();
  const init: Record<string, any> | null = row
    ? { ...row, ...(row.slug ? { slug: decodeSlugSafe(row.slug) } : {}) }
    : entity === "terms"
      ? { taxonomy: sp1(sp, "taxonomy") || "product_cat", menu_order: 0 }
      : entity === "redirects"
        ? { status_code: 301, kind: "manual" }
        : entity === "coupons"
          ? { status: "publish", discount_type: "fixed_cart", amount: 0 }
          : entity === "settings"
            ? { is_public: true, value: {} }
            : entity === "discount_rules"
              ? { min_qty: 1, discount_type: "percent", discount_value: 10, active: true, priority: 0, source: "manual" }
              : null;
  const fields = def.fields.filter((f) => !(entity === "settings" && f.name === "key"));
  const mediaIds = fields.filter((f) => f.type === "media").map((f) => init?.[f.name]);
  const ctx = { media: await mediaMap(mediaIds), terms: entity === "terms" || entity === "discount_rules" ? await allTerms() : undefined };
  const listHref = `/admin/e/${entity}/${entity === "terms" && init?.taxonomy ? `?taxonomy=${init.taxonomy}` : ""}`;
  const back = entity === "settings" ? "/admin/settings/" : entity === "menus" && !isNew ? `/admin/menus/${id}/` : listHref;
  const here = `/admin/e/${entity}/${encodeURIComponent(id)}/`;

  let extra: React.ReactNode = null;
  if (entity === "customers" && row) {
    const { data: orders } = await serviceDb().from("orders").select("id,status,total,date_created").eq("customer_id", row.id).order("date_created", { ascending: false }).limit(50);
    extra = (
      <div className="adm-card">
        <h2 className="adm-h2">訂單（{orders?.length || 0}）</h2>
        {orders?.length ? (
          <ul>{orders.map((o) => <li key={o.id}><a href={`/admin/orders/${o.id}/`}>#{o.id}</a> {o.status} {fmtMoney(o.total)} {fmtDate(o.date_created)}</li>)}</ul>
        ) : <p className="adm-muted">沒有訂單</p>}
        <p className="adm-muted">註冊：{fmtDate(row.date_created)}・累計 {fmtMoney(row.total_spent)}・{row.auth_user_id ? "已綁定登入帳號" : "未綁定登入帳號"}</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="adm-h1">
        {isNew ? `新增${def.label}` : `${def.label}：${row?.name || row?.title || row?.label || row?.code || row?.email || row?.source_path || row?.key || id}`}
        <a className="adm-btn sm" href={back}>回列表</a>
      </h1>
      <Flash sp={sp} />
      <div className="adm-grid">
        <div>
          {def.readonly ? (
            <div className="adm-card"><pre className="adm-json">{JSON.stringify(row, null, 2)}</pre></div>
          ) : (
            <form action={saveRecordAction.bind(null, entity, isNew ? null : id, here)} className="adm-card">
              {entity === "settings" && isNew ? (
                <div className="adm-field">
                  <label htmlFor="key">設定鍵（小寫英數、底線、點，如 contact.hours）</label>
                  <input id="key" name="key" required pattern="[a-z0-9_.\-]+" />
                </div>
              ) : null}
              <FieldSet fields={fields} row={init} ctx={ctx} />
              <button className="adm-btn pri" type="submit">{isNew ? "新增" : "儲存"}</button>
            </form>
          )}
          {extra}
        </div>
        <aside>
          {!isNew && row ? (
            <div className="adm-card">
              <p className="adm-muted">
                ID：{String(row[def.pk])}
                {row.created_at ? <><br />建立：{fmtDate(row.created_at)}</> : null}
                {row.updated_at ? <><br />更新：{fmtDate(row.updated_at)}</> : null}
                {entity === "terms" ? <><br />商品／文章數：{row.count}<br />{row.path ? <a href={row.path} target="_blank" rel="noreferrer">檢視前台 ↗</a> : null}</> : null}
              </p>
              {!def.readonly ? (
                <form action={deleteRecordAction.bind(null, entity, id, back)}>
                  <input type="hidden" name="errorTo" value={here} />
                  <ConfirmButton message="確定刪除？此動作無法復原。">刪除</ConfirmButton>
                </form>
              ) : null}
            </div>
          ) : null}
          <div className="adm-card">
            <p className="adm-muted">
              {entity === "discount_rules" ? "票種／團報折扣：percent 的折扣值 10＝打 9 折、5＝95 折；persons 為一張票涵蓋的人數（2 人同行＝2）。變體名稱解析出的規則來源為 variation_label。" : null}
              {entity === "coupons" ? "代碼會自動轉為小寫（同 WooCommerce）。結帳時套用於前台購物車。" : null}
              {entity === "redirects" ? "來源路徑會自動解碼並補上結尾斜線；410 表示已永久移除。前台轉址表有 10 分鐘快取，變更約 10 分鐘內生效。" : null}
              {entity === "terms" ? "代稱留空會依名稱自動產生（中文以小寫 percent-encoding 保存，同 WordPress）；網址路徑留空依分類法與上層分類自動產生。" : null}
              {entity === "admins" ? "管理員帳號需透過 Supabase Auth 建立，再寫入 site_dayinup.admins。" : null}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
