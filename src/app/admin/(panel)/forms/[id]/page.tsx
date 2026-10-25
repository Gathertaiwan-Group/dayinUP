import { requireAdmin } from "@/lib/admin/guard";
import { notFound } from "next/navigation";
import { serviceDb } from "@/lib/supabase";
import { fmtDate, qs } from "@/lib/admin/format";
import { sp1, type SP } from "@/lib/admin/loaders";
import { Badge, Flash, Pager } from "@/components/admin/Fields";
import { submissionStatusAction } from "../../../actions";

export default async function FormSubmissions({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const status = sp1(sp, "status");
  const offset = Number(sp1(sp, "offset")) || 0;
  const db = serviceDb();
  const { data: form } = await db.from("forms").select("*").eq("id", Number(id)).maybeSingle();
  if (!form) notFound();
  let q = db.from("form_submissions").select("*", { count: "exact" }).eq("form_id", form.id).order("created_at", { ascending: false }).range(offset, offset + 49);
  if (status) q = q.eq("status", status);
  const { data: rows, count } = await q;
  const keys = [...new Set((rows || []).flatMap((r) => Object.keys(r.data || {})))].slice(0, 8);
  const here = `/admin/forms/${id}/${qs({ status, offset })}`;
  return (
    <>
      <h1 className="adm-h1">
        {form.name} <a className="adm-btn sm" href="/admin/forms/">回表單列表</a>
        <a className="adm-btn sm" href={`/admin/forms-export/${id}/${qs({ status })}`}>匯出 CSV</a>
      </h1>
      <Flash sp={sp} />
      <div className="adm-tabs">
        {["", "unread", "read", "spam", "trash"].map((s) => (
          <a key={s} href={`/admin/forms/${id}/${qs({ status: s })}`} className={s === status ? "on" : ""}>{({ "": "全部", unread: "未讀", read: "已讀", spam: "垃圾", trash: "垃圾桶" } as Record<string, string>)[s]}</a>
        ))}
      </div>
      <form action={submissionStatusAction.bind(null, id)}>
        <input type="hidden" name="returnTo" value={here} />
        <div className="adm-filters">
          <select name="status" defaultValue="read" aria-label="批次動作">
            <option value="read">標為已讀</option>
            <option value="unread">標為未讀</option>
            <option value="spam">標為垃圾</option>
            <option value="trash">移到垃圾桶</option>
            <option value="delete">刪除</option>
          </select>
          <button className="adm-btn" type="submit">套用到勾選項目</button>
        </div>
        <table className="adm-table">
          <thead>
            <tr>
              <th></th>
              <th>時間</th>
              <th>狀態</th>
              {keys.map((k) => <th key={k}>{k}</th>)}
              <th>詳細</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id}>
                <td><input type="checkbox" name="ids" value={r.id} aria-label={`選取 #${r.id}`} /></td>
                <td>{fmtDate(r.created_at)}</td>
                <td><Badge v={r.status} /></td>
                {keys.map((k) => <td key={k} className="clip">{typeof r.data?.[k] === "object" ? JSON.stringify(r.data?.[k]) : String(r.data?.[k] ?? "")}</td>)}
                <td>
                  <details>
                    <summary>#{r.id}</summary>
                    <pre className="adm-json">{JSON.stringify({ data: r.data, ip: r.ip, user_agent: r.user_agent, source_url: r.source_url }, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
            {!rows?.length ? (
              <tr><td colSpan={keys.length + 4} className="adm-muted">沒有提交紀錄</td></tr>
            ) : null}
          </tbody>
        </table>
      </form>
      <Pager total={count || 0} offset={offset} limit={50} href={(o) => `/admin/forms/${id}/${qs({ status, offset: o })}`} />
    </>
  );
}
