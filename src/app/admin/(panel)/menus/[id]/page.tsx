import { requireAdmin } from "@/lib/admin/guard";
import { notFound } from "next/navigation";
import { serviceDb } from "@/lib/supabase";
import { getRecord } from "@/lib/admin/service";
import { ENTITIES } from "@/lib/admin/entities";
import { decodeSlugSafe } from "@/lib/admin/format";
import { allTerms, type SP } from "@/lib/admin/loaders";
import { FieldSet, Flash } from "@/components/admin/Fields";
import { ConfirmButton } from "@/components/admin/Confirm";
import { deleteRecordAction, saveMenuItemsAction, saveRecordAction } from "../../../actions";

export default async function MenuEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const menu = await getRecord("menus", Number(id));
  if (!menu) notFound();
  const db = serviceDb();
  const [{ data: items }, { data: pages }, cats] = await Promise.all([
    db.from("menu_items").select("*").eq("menu_id", menu.id).order("position"),
    db.from("posts").select("id,title,path").eq("post_type", "page").eq("status", "publish").order("title"),
    allTerms(["product_cat"]),
  ]);
  const list = items || [];
  const here = `/admin/menus/${id}/`;
  const typeOpts = ["custom", "page", "post", "product_cat", "product_tag", "category", "post_tag", "product"];
  return (
    <>
      <h1 className="adm-h1">
        編輯選單：{menu.name} <a className="adm-btn sm" href="/admin/menus/">回選單列表</a>
      </h1>
      <Flash sp={sp} />
      <div className="adm-grid">
        <form action={saveMenuItemsAction.bind(null, id)} className="adm-card">
          <input type="hidden" name="__items" value={list.map((i) => i.id).join(",")} />
          <h2 className="adm-h2">選單項目</h2>
          <table className="adm-table">
            <thead>
              <tr>
                <th>排序</th>
                <th>標籤</th>
                <th>網址</th>
                <th>上層</th>
                <th>類型／ID</th>
                <th>新分頁</th>
                <th>刪除</th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id}>
                  <td><input type="number" name={`position_${i.id}`} defaultValue={i.position} style={{ width: 60 }} aria-label="排序" /></td>
                  <td><input name={`title_${i.id}`} defaultValue={i.label} aria-label="標籤" /></td>
                  <td><input name={`url_${i.id}`} defaultValue={i.url} aria-label="網址" /></td>
                  <td>
                    <select name={`parent_${i.id}`} defaultValue={i.parent_id ? String(i.parent_id) : ""} aria-label="上層項目">
                      <option value="">（頂層）</option>
                      {list.filter((x) => x.id !== i.id).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select name={`type_${i.id}`} defaultValue={i.object_type || "custom"} aria-label="類型">
                      {typeOpts.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input name={`oid_${i.id}`} defaultValue={i.object_id ?? ""} style={{ width: 80 }} aria-label="物件 ID" />
                    <input type="hidden" name={`css_${i.id}`} value={i.classes || ""} />
                  </td>
                  <td><input type="checkbox" name={`target_${i.id}`} value="_blank" defaultChecked={i.target === "_blank"} aria-label="新分頁開啟" /></td>
                  <td><input type="checkbox" name={`del_${i.id}`} aria-label="刪除" /></td>
                </tr>
              ))}
              <tr>
                <td><input type="number" name="new_position" defaultValue={list.length} style={{ width: 60 }} aria-label="新項目排序" /></td>
                <td><input name="new_title" placeholder="新項目標籤" aria-label="新項目標籤" /></td>
                <td><input name="new_url" placeholder="/product-category/xxx/ 或 https://" aria-label="新項目網址" /></td>
                <td>
                  <select name="new_parent" aria-label="新項目上層">
                    <option value="">（頂層）</option>
                    {list.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </td>
                <td>
                  <select name="new_type" defaultValue="custom" aria-label="新項目類型">
                    {typeOpts.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input name="new_oid" style={{ width: 80 }} aria-label="新項目物件 ID" />
                </td>
                <td><input type="checkbox" name="new_target" value="_blank" aria-label="新項目新分頁開啟" /></td>
                <td></td>
              </tr>
            </tbody>
          </table>
          <button className="adm-btn pri adm-mt" type="submit">儲存選單</button>
          <details className="adm-mt">
            <summary>快速參考：頁面與商品分類網址</summary>
            <div className="adm-cols2">
              <ul>{(pages || []).map((p) => <li key={p.id}>{p.title}：<code>{decodeSlugSafe(p.path)}</code>（page #{p.id}）</li>)}</ul>
              <ul>{cats.map((c) => <li key={c.id}>{c.name}：<code>{c.path || `/product-category/${decodeSlugSafe(c.slug)}/`}</code>（product_cat #{c.id}）</li>)}</ul>
            </div>
          </details>
        </form>
        <aside>
          <form action={saveRecordAction.bind(null, "menus", id, here)} className="adm-card">
            <h2 className="adm-h2">選單設定</h2>
            <FieldSet fields={ENTITIES.menus.fields.filter((f) => f.name !== "meta")} row={menu} />
            <button className="adm-btn pri" type="submit">儲存設定</button>
          </form>
          <form action={deleteRecordAction.bind(null, "menus", id, "/admin/menus/")} className="adm-card">
            <input type="hidden" name="errorTo" value={here} />
            <ConfirmButton message="刪除整個選單與所有項目？">刪除選單</ConfirmButton>
          </form>
        </aside>
      </div>
    </>
  );
}
