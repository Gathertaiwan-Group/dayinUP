import { serviceDb } from "@/lib/supabase";
import type { SP } from "@/lib/admin/loaders";
import { Flash } from "@/components/admin/Fields";

const LOC: Record<string, string> = { header: "主選單（頁首＋行動版抽屜）", offcanvas: "行動版選單", footer: "頁尾" };

export default async function Menus({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { data: menus } = await serviceDb().from("menus").select("id,name,slug,location,meta,menu_items(id)").order("id");
  return (
    <>
      <h1 className="adm-h1">
        選單 <a className="adm-btn" href="/admin/e/menus/new/">新增選單</a>
      </h1>
      <Flash sp={sp} />
      <table className="adm-table">
        <thead>
          <tr>
            <th>名稱</th>
            <th>位置</th>
            <th>項目數</th>
            <th>說明</th>
          </tr>
        </thead>
        <tbody>
          {(menus || []).map((m: any) => (
            <tr key={m.id}>
              <td><a href={`/admin/menus/${m.id}/`}><b>{m.name}</b></a><div className="adm-muted">#{m.id}・{m.slug}</div></td>
              <td>{m.location ? LOC[m.location] || m.location : "（未指定）"}</td>
              <td>{(m.menu_items || []).length}</td>
              <td className="adm-muted">{m.meta?.note || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="adm-muted adm-mt">前台頁首主選單與行動版抽屜讀取代稱為「main」的選單（兩層）。資料已由舊站 WordPress 選單（nav_menu／nav_menu_item）匯入，項目編號沿用舊站；草稿項目不會顯示於前台。</p>
    </>
  );
}
