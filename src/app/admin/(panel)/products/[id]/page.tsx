import { notFound } from "next/navigation";
import { getProductFull, listRecords } from "@/lib/admin/service";
import { ENTITIES, POST_STATUS_LABEL, type Field } from "@/lib/admin/entities";
import { decodeSlugSafe, fmtDate, fmtMoney, toLocalInput } from "@/lib/admin/format";
import { allTerms, mediaMap, type SP } from "@/lib/admin/loaders";
import { Badge, FieldInput, FieldSet, Flash } from "@/components/admin/Fields";
import { GalleryPicker } from "@/components/admin/MediaPicker";
import { ConfirmButton } from "@/components/admin/Confirm";
import { deleteRecordAction, saveChildAction, saveProductAction } from "../../../actions";

export default async function ProductEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === "new";
  const p = isNew ? null : await getProductFull(Number(id));
  if (!isNew && !p) notFound();
  const F = Object.fromEntries(ENTITIES.products.fields.map((f) => [f.name, f])) as Record<string, Field>;
  const terms = await allTerms(["product_cat", "product_tag", "product_brand"]);
  const rules = p ? (await listRecords("discount_rules", { filters: { product_id: p.id }, limit: 100, order: ["priority", true] })).rows : [];
  const selected = new Set((p?.terms || []).map((t: any) => t?.id));
  const status = p?.status || "draft";
  const seo = (p?.seo || {}) as Record<string, any>;
  const varMedia = await mediaMap((p?.variations || []).map((v: any) => v.image_media_id));
  const row: Record<string, any> = p ? { ...p, slug: decodeSlugSafe(p.slug) } : { type: "simple", catalog_visibility: "visible", stock_status: "instock", backorders: "no", tax_status: "taxable", is_purchasable: true, virtual: true, menu_order: 0, dimensions: {} };
  const names = [
    "name", "slug", "type", "featured", "catalog_visibility", "sku", "regular_price", "sale_price", "date_on_sale_from", "date_on_sale_to",
    "manage_stock", "stock_quantity", "stock_status", "backorders", "low_stock_amount", "sold_individually", "is_purchasable", "virtual", "downloadable",
    "weight", "tax_status", "tax_class", "menu_order", "short_description_html", "description_html", "external_url", "button_text", "featured_media_id", "date",
  ];
  const fi = (n: string) => <FieldInput f={F[n]} row={row} />;
  const VF = ENTITIES.product_variations.fields.filter((f) => !["product_id", "description_html"].includes(f.name));
  const RF = ENTITIES.discount_rules.fields.filter((f) => f.name !== "product_id" && f.name !== "term_id");
  const AF = ENTITIES.product_attributes.fields.filter((f) => f.name !== "product_id");

  return (
    <>
      <form action={saveProductAction.bind(null, isNew ? null : id)}>
        <input type="hidden" name="__fields" value={names.join(",")} />
        <h1 className="adm-h1">
          {isNew ? "新增商品" : "編輯商品"} {!isNew ? <Badge v={status} /> : null}
          <a className="adm-btn sm" href="/admin/products/">回列表</a>
        </h1>
        <Flash sp={sp} />
        <div className="adm-grid">
          <div>
            <div className="adm-card">
              <div className="adm-field">
                <input className="adm-title" name="name" defaultValue={p?.name || ""} placeholder="商品名稱" aria-label="商品名稱" required />
              </div>
              <FieldInput f={{ ...F.slug, help: `網址：/product/${row.slug || "（依名稱產生）"}/` }} row={row} />
              {fi("description_html")}
            </div>
            <div className="adm-card">
              <h2 className="adm-h2">商品資料</h2>
              <div className="adm-cols3">
                {fi("type")}
                {fi("sku")}
                {fi("catalog_visibility")}
              </div>
              <h3 className="adm-h2 adm-mt">價格</h3>
              <div className="adm-cols2">
                {fi("regular_price")}
                {fi("sale_price")}
                {fi("date_on_sale_from")}
                {fi("date_on_sale_to")}
              </div>
              {p ? <p className="adm-muted">目前售價：{fmtMoney(p.price)}{p.on_sale ? "（特價中）" : ""}</p> : null}
              <h3 className="adm-h2 adm-mt">庫存</h3>
              {fi("manage_stock")}
              <div className="adm-cols3">
                {fi("stock_quantity")}
                {fi("stock_status")}
                {fi("backorders")}
                {fi("low_stock_amount")}
              </div>
              {fi("sold_individually")}
              {fi("is_purchasable")}
              <h3 className="adm-h2 adm-mt">運送與稅務</h3>
              {fi("virtual")}
              {fi("downloadable")}
              <div className="adm-cols3">
                {fi("weight")}
                {fi("tax_status")}
              </div>
              <input type="hidden" name="tax_class" value={String((row as any).tax_class ?? "")} />
              {row.type === "external" ? (
                <div className="adm-cols2">
                  {fi("external_url")}
                  {fi("button_text")}
                </div>
              ) : (
                <>
                  <input type="hidden" name="external_url" value={String(row.external_url ?? "")} />
                  <input type="hidden" name="button_text" value={String(row.button_text ?? "")} />
                </>
              )}
              <input type="hidden" name="featured_media_id" value={String(row.featured_media_id ?? "")} />
            </div>
            <div className="adm-card">
              <h2 className="adm-h2">商品簡短說明</h2>
              <FieldInput f={{ ...F.short_description_html, label: "" }} row={row} />
            </div>
            <div className="adm-card">
              <h2 className="adm-h2">SEO</h2>
              <div className="adm-field">
                <label htmlFor="seo_title">SEO 標題</label>
                <input id="seo_title" name="seo_title" defaultValue={seo.title || ""} />
              </div>
              <div className="adm-field">
                <label htmlFor="seo_description">SEO 描述</label>
                <textarea id="seo_description" name="seo_description" className="plain" rows={2} defaultValue={seo.description || ""} />
              </div>
              <div className="adm-field">
                <label htmlFor="seo_robots">Robots</label>
                <input id="seo_robots" name="seo_robots" defaultValue={seo.robots || ""} placeholder="follow, index" />
              </div>
            </div>
          </div>
          <aside>
            <div className="adm-card">
              <h2 className="adm-h2">發布</h2>
              <p className="adm-muted">
                狀態：{POST_STATUS_LABEL[status]}
                {p?.date ? <><br />{status === "future" ? "排程於" : "發布於"} {fmtDate(p.date)}</> : null}
              </p>
              <div className="adm-field">
                <label htmlFor="date">發布時間（排程請設未來時間）</label>
                <input type="datetime-local" id="date" name="date" defaultValue={toLocalInput(p?.date)} />
              </div>
              {fi("featured")}
              <div className="adm-row">
                <button className="adm-btn" type="submit" name="intent" value="draft">儲存草稿</button>
                <button className="adm-btn" type="submit" name="intent" value="preview">儲存並預覽</button>
              </div>
              <div className="adm-row adm-mt">
                <button className="adm-btn pri" type="submit" name="intent" value="publish">{status === "publish" ? "更新" : "發布"}</button>
                <button className="adm-btn" type="submit" name="intent" value="schedule">排程</button>
                {!isNew && status !== "draft" && status !== "publish" ? <button className="adm-btn" type="submit" name="intent" value="save">儲存</button> : null}
              </div>
              {p && status === "publish" ? (
                <p className="adm-mt"><a href={p.path || `/product/${p.slug}/`} target="_blank" rel="noreferrer">檢視商品 ↗</a></p>
              ) : null}
            </div>
            <div className="adm-card">
              <h2 className="adm-h2">商品圖片（第一張為主圖）</h2>
              <GalleryPicker name="gallery" initial={(p?.images || []).filter((m: any) => m?.id).map((m: any) => ({ id: m.id, url: m.public_url || "", title: m.title }))} />
            </div>
            <div className="adm-card">
              <input type="hidden" name="__terms" value="1" />
              {["product_cat", "product_tag", "product_brand"].map((tax) => (
                <div key={tax} className="adm-field">
                  <label>{({ product_cat: "商品分類", product_tag: "商品標籤", product_brand: "品牌" } as Record<string, string>)[tax]}</label>
                  {terms.filter((t) => t.taxonomy === tax).map((t) => (
                    <div key={t.id} style={{ paddingLeft: t.parent_id ? 16 : 0 }}>
                      <label className="adm-check"><input type="checkbox" name="term_ids" value={t.id} defaultChecked={selected.has(t.id)} /> {t.name}</label>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="adm-card">
              {fi("menu_order")}
            </div>
            {!isNew ? (
              <div className="adm-card">
                <ConfirmButton message="移到垃圾桶？" formAction={deleteRecordAction.bind(null, "products", id, "/admin/products/")}>移到垃圾桶</ConfirmButton>
              </div>
            ) : null}
          </aside>
        </div>
      </form>

      {p ? (
        <>
          <div className="adm-card" id="attributes">
            <h2 className="adm-h2">商品屬性</h2>
            {(p.attributes || []).map((a: any) => (
              <details key={a.id} className="adm-card">
                <summary><b>{a.name}</b>：{(a.options || []).join("、")} {a.is_variation ? "（用於變體）" : ""}</summary>
                <form action={saveChildAction.bind(null, "product_attributes", id, String(a.id))} className="adm-mt">
                  <FieldSet fields={AF} row={a} />
                  <div className="adm-row">
                    <button className="adm-btn pri" type="submit">儲存屬性</button>
                    <ConfirmButton className="adm-btn danger" message="刪除此屬性？" formAction={deleteRecordAction.bind(null, "product_attributes", String(a.id), `/admin/products/${id}/#attributes`)}>刪除</ConfirmButton>
                  </div>
                </form>
              </details>
            ))}
            <details>
              <summary>新增屬性</summary>
              <form action={saveChildAction.bind(null, "product_attributes", id, null)} className="adm-mt">
                <FieldSet fields={AF} row={{ is_visible: true, is_variation: true, position: (p.attributes || []).length }} />
                <button className="adm-btn pri" type="submit">新增屬性</button>
              </form>
            </details>
          </div>
          <div className="adm-card" id="variations">
            <h2 className="adm-h2">商品變體（票種） {p.type !== "variable" ? <span className="adm-muted">（商品類型需為 variable 才會在前台顯示變體）</span> : null}</h2>
            {(p.variations || []).map((v: any) => (
              <details key={v.id} className="adm-card">
                <summary>
                  #{v.id} {Object.entries(v.attributes || {}).map(([k, x]) => `${k}=${x}`).join("、") || "（未設定屬性）"}・{fmtMoney(v.price)}{v.on_sale ? `（原價 ${fmtMoney(v.regular_price)}）` : ""}・<Badge v={v.stock_status} /> {v.manage_stock ? v.stock_quantity : ""}
                </summary>
                <form action={saveChildAction.bind(null, "product_variations", id, String(v.id))} className="adm-mt">
                  <div className="adm-cols3">
                    <FieldSet fields={VF} row={v} ctx={{ media: varMedia }} />
                  </div>
                  <div className="adm-row">
                    <button className="adm-btn pri" type="submit">儲存變體</button>
                    <ConfirmButton className="adm-btn danger" message="刪除此變體？" formAction={deleteRecordAction.bind(null, "product_variations", String(v.id), `/admin/products/${id}/#variations`)}>刪除</ConfirmButton>
                  </div>
                </form>
              </details>
            ))}
            <details>
              <summary>新增變體</summary>
              <form action={saveChildAction.bind(null, "product_variations", id, null)} className="adm-mt">
                <div className="adm-cols3">
                  <FieldSet fields={VF} row={{ status: "publish", stock_status: "instock", backorders: "no", attributes: {}, menu_order: (p.variations || []).length }} />
                </div>
                <button className="adm-btn pri" type="submit">新增變體</button>
              </form>
            </details>
            {p.type === "variable" ? <p className="adm-muted">變體價格變更後，商品的價格區間（{fmtMoney(p.price_min)}–{fmtMoney(p.price_max)}）會自動重算。</p> : null}
          </div>
          <div className="adm-card" id="discounts">
            <h2 className="adm-h2">票種／團報折扣規則</h2>
            <p className="adm-muted">舊站以變體名稱標示折扣（如「早鳥票（9折）」「2人同行（95折）」「3人同行（9折）」）；實際售價以各變體的原價／特價為準，以下規則供前台折扣說明表與報表使用。</p>
            <table className="adm-table">
              <thead><tr><th>名稱</th><th>變體</th><th>人數</th><th>折扣</th><th>期間</th><th>啟用</th></tr></thead>
              <tbody>
                {rules.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <details>
                        <summary>{r.label}</summary>
                        <form action={saveChildAction.bind(null, "discount_rules", id, String(r.id))} className="adm-mt">
                          <div className="adm-cols3"><FieldSet fields={RF} row={r} /></div>
                          <div className="adm-row">
                            <button className="adm-btn pri" type="submit">儲存規則</button>
                            <ConfirmButton className="adm-btn danger" message="刪除此規則？" formAction={deleteRecordAction.bind(null, "discount_rules", String(r.id), `/admin/products/${id}/#discounts`)}>刪除</ConfirmButton>
                          </div>
                        </form>
                      </details>
                    </td>
                    <td>{r.variation_id ? `#${r.variation_id}` : "—"}</td>
                    <td>{r.persons ?? "—"}</td>
                    <td>{r.discount_type === "percent" ? `${100 - Number(r.discount_value)}% 價（-${Number(r.discount_value)}%）` : `${r.discount_type} ${r.discount_value}`}</td>
                    <td>{r.starts_at || r.ends_at ? `${fmtDate(r.starts_at)} – ${fmtDate(r.ends_at)}` : "—"}</td>
                    <td>{r.active ? "✓" : "—"}</td>
                  </tr>
                ))}
                {!rules.length ? <tr><td colSpan={6} className="adm-muted">尚無規則</td></tr> : null}
              </tbody>
            </table>
            <details>
              <summary>新增規則</summary>
              <form action={saveChildAction.bind(null, "discount_rules", id, null)} className="adm-mt">
                <div className="adm-cols3"><FieldSet fields={RF} row={{ min_qty: 1, discount_type: "percent", discount_value: 10, active: true, priority: 0, source: "manual" }} /></div>
                <button className="adm-btn pri" type="submit">新增規則</button>
              </form>
            </details>
          </div>
        </>
      ) : null}
    </>
  );
}
