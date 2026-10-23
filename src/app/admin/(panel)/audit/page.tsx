import { listRecords } from "@/lib/admin/service";
import { fmtDate, qs } from "@/lib/admin/format";
import { sp1, type SP } from "@/lib/admin/loaders";
import { Pager } from "@/components/admin/Fields";

export default async function Audit({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const base = { entity_type: sp1(sp, "entity_type"), via: sp1(sp, "via"), action: sp1(sp, "action"), q: sp1(sp, "q") };
  const offset = Number(sp1(sp, "offset")) || 0;
  const { rows, total, limit } = await listRecords("audit_log", {
    q: base.q,
    filters: { entity_type: base.entity_type, via: base.via, action: base.action },
    offset,
    limit: 50,
  });
  return (
    <>
      <h1 className="adm-h1">稽核紀錄</h1>
      <form className="adm-filters" method="get">
        <select name="via" defaultValue={base.via} aria-label="操作者">
          <option value="">所有操作者</option>
          <option value="admin">後台（admin）</option>
          <option value="mcp">MCP</option>
          <option value="system">系統</option>
          <option value="import">資料匯入</option>
        </select>
        <input name="entity_type" defaultValue={base.entity_type} placeholder="資料類型（如 posts）" />
        <input name="action" defaultValue={base.action} placeholder="動作（如 update）" />
        <input type="search" name="q" defaultValue={base.q} placeholder="ID／Email" />
        <button className="adm-btn" type="submit">篩選</button>
      </form>
      <table className="adm-table">
        <thead>
          <tr>
            <th>時間</th>
            <th>操作者</th>
            <th>動作</th>
            <th>對象</th>
            <th>變更</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{fmtDate(r.created_at)}</td>
              <td>
                {r.via}
                <div className="adm-muted">{r.actor}{r.ip ? `・${r.ip}` : ""}</div>
              </td>
              <td>{r.action}</td>
              <td>{r.entity_type} #{r.entity_id}</td>
              <td>
                {r.before || r.after ? (
                  <details>
                    <summary>檢視</summary>
                    <div className="adm-cols2">
                      <div><b>之前</b><pre className="adm-json">{JSON.stringify(r.before, null, 2)}</pre></div>
                      <div><b>之後</b><pre className="adm-json">{JSON.stringify(r.after, null, 2)}</pre></div>
                    </div>
                  </details>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager total={total} offset={offset} limit={limit} href={(o) => `/admin/audit/${qs(base, { offset: o })}`} />
    </>
  );
}
