import { requireAdmin } from "@/lib/admin/guard";
import { listRecords } from "@/lib/admin/service";
import { POST_STATUS_LABEL } from "@/lib/admin/entities";
import { decodeSlugSafe, fmtDate, qs } from "@/lib/admin/format";
import { sp1, countOf, type SP } from "@/lib/admin/loaders";
import { Badge, Flash, Pager } from "@/components/admin/Fields";
import { ConfirmButton } from "@/components/admin/Confirm";
import { deleteRecordAction, restoreAction } from "../../actions";

const TYPE_LABEL: Record<string, string> = { post: "文章", page: "頁面", ct_content_block: "內容區塊", wp_block: "可重複使用區塊" };

export default async function ContentList({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;
  const type = TYPE_LABEL[sp1(sp, "type")] ? sp1(sp, "type") : "page";
  const status = sp1(sp, "status");
  const q = sp1(sp, "q");
  const offset = Number(sp1(sp, "offset")) || 0;
  const base = { type, status, q };
  const here = `/admin/content/${qs(base, { offset })}`;
  const { rows, total, limit } = await listRecords("posts", {
    q,
    filters: { post_type: type, status: status || undefined },
    offset,
    limit: 50,
    columns: "id,title,slug,status,path,date,modified,updated_at",
    order: type === "page" ? ["title", true] : ["updated_at", false],
  });
  const visible = status ? rows : rows.filter((r) => r.status !== "trash");
  const counts = await Promise.all(
    ["", "publish", "draft", "pending", "future", "private", "trash"].map(async (s) => [s, await countOf("posts", (qq) => (s ? qq.eq("post_type", type).eq("status", s) : qq.eq("post_type", type).neq("status", "trash")))] as const),
  );
  return (
    <>
      <h1 className="adm-h1">
        {TYPE_LABEL[type]}
        <a className="adm-btn" href={`/admin/content/new/?type=${type}`}>新增{TYPE_LABEL[type]}</a>
      </h1>
      <Flash sp={sp} />
      <div className="adm-tabs">
        {counts.map(([s, n]) => (
          <a key={s} href={`/admin/content/${qs({ type, status: s })}`} className={s === status ? "on" : ""}>
            {s ? POST_STATUS_LABEL[s] : "全部"} ({n})
          </a>
        ))}
      </div>
      <form className="adm-filters" method="get">
        <input type="hidden" name="type" value={type} />
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <input type="search" name="q" defaultValue={q} placeholder={`搜尋${TYPE_LABEL[type]}`} />
        <button className="adm-btn" type="submit">搜尋</button>
      </form>
      <table className="adm-table">
        <thead>
          <tr>
            <th>標題</th>
            <th>狀態</th>
            <th>網址</th>
            <th>日期</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.id}>
              <td>
                <a href={`/admin/content/${r.id}/`}><b>{r.title || "（無標題）"}</b></a>
                <div className="adm-muted">#{r.id}・{decodeSlugSafe(r.slug)}</div>
              </td>
              <td><Badge v={r.status} /> {POST_STATUS_LABEL[r.status]}</td>
              <td className="clip">{r.path && r.status === "publish" ? <a href={r.path} target="_blank" rel="noreferrer">{decodeSlugSafe(r.path)}</a> : decodeSlugSafe(r.path) || "—"}</td>
              <td>
                {r.status === "future" ? "排程：" : r.status === "publish" ? "發布：" : "修改："}
                {fmtDate(r.status === "publish" || r.status === "future" ? r.date : r.updated_at)}
              </td>
              <td className="num">
                <div className="adm-row" style={{ justifyContent: "flex-end" }}>
                  <a className="adm-btn sm" href={`/admin-preview/post/${r.id}/`} target="_blank" rel="noreferrer">預覽</a>
                  {r.status === "trash" ? (
                    <>
                      <form action={restoreAction.bind(null, "posts", String(r.id), here)}>
                        <button className="adm-btn sm" type="submit">還原</button>
                      </form>
                      <form action={deleteRecordAction.bind(null, "posts", String(r.id), here)}>
                        <input type="hidden" name="force" value="1" />
                        <ConfirmButton className="adm-btn sm danger" message="永久刪除後無法復原，確定？">永久刪除</ConfirmButton>
                      </form>
                    </>
                  ) : (
                    <form action={deleteRecordAction.bind(null, "posts", String(r.id), here)}>
                      <ConfirmButton className="adm-btn sm danger" message="移到垃圾桶？">垃圾桶</ConfirmButton>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!visible.length ? (
            <tr>
              <td colSpan={5} className="adm-muted">沒有資料</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <Pager total={total} offset={offset} limit={limit} href={(o) => `/admin/content/${qs(base, { offset: o })}`} />
    </>
  );
}
