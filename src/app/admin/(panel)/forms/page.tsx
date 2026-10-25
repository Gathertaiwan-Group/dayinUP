import { serviceDb } from "@/lib/supabase";
import type { SP } from "@/lib/admin/loaders";
import { Badge, Flash } from "@/components/admin/Fields";

export default async function Forms({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const db = serviceDb();
  const { data: forms } = await db.from("forms").select("id,name,slug,form_type,status,source,pages").order("id");
  const counts = await Promise.all(
    (forms || []).map(async (f) => {
      const [{ count: all }, { count: fresh }] = await Promise.all([
        db.from("form_submissions").select("id", { count: "exact", head: true }).eq("form_id", f.id),
        db.from("form_submissions").select("id", { count: "exact", head: true }).eq("form_id", f.id).eq("status", "unread"),
      ]);
      return [f.id, all || 0, fresh || 0] as const;
    }),
  );
  const c = new Map(counts.map(([id, a, n]) => [id, { a, n }]));
  return (
    <>
      <h1 className="adm-h1">表單提交</h1>
      <Flash sp={sp} />
      <table className="adm-table">
        <thead>
          <tr>
            <th>表單</th>
            <th>類型</th>
            <th>提交數</th>
            <th>未讀</th>
            <th>狀態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(forms || []).map((f) => (
            <tr key={f.id}>
              <td><a href={`/admin/forms/${f.id}/`}><b>{f.name}</b></a><div className="adm-muted">{f.slug}</div></td>
              <td>{f.form_type}<div className="adm-muted">{f.source}・{(f.pages || []).join(" ")}</div></td>
              <td>{c.get(f.id)?.a ?? 0}</td>
              <td>{c.get(f.id)?.n ? <Badge v="unread" /> : null} {c.get(f.id)?.n || ""}</td>
              <td>{f.status === "published" ? "啟用" : f.status}</td>
              <td className="num">
                <a className="adm-btn sm" href={`/admin/forms-export/${f.id}/`}>匯出 CSV</a> <a className="adm-btn sm" href={`/admin/e/forms/${f.id}/`}>表單設定</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="adm-muted adm-mt">聯絡我們、電子報訂閱等前台表單的提交會記錄於此（密碼等敏感欄位不儲存）。舊站 Fluent Forms 與 Elementor 表單的提交紀錄已匯入。</p>
    </>
  );
}
