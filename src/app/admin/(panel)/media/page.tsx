import { listRecords } from "@/lib/admin/service";
import { fmtBytes, qs } from "@/lib/admin/format";
import { sp1, type SP } from "@/lib/admin/loaders";
import { Flash, Pager } from "@/components/admin/Fields";
import { uploadMediaAction } from "../../actions";

export default async function MediaLibrary({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = sp1(sp, "q");
  const type = sp1(sp, "type");
  const offset = Number(sp1(sp, "offset")) || 0;
  const { rows, total, limit } = await listRecords("media", {
    q,
    offset,
    limit: 60,
    columns: "id,title,mime_type,public_url,storage_path,original_file,bytes,width,height,status",
    filters: {},
  });
  const shown = type ? rows.filter((r) => String(r.mime_type || "").startsWith(type)) : rows;
  return (
    <>
      <h1 className="adm-h1">媒體庫</h1>
      <Flash sp={sp} />
      <form action={uploadMediaAction} className="adm-card">
        <h2 className="adm-h2">上傳新媒體</h2>
        <div className="adm-row">
          <input type="file" name="files" multiple accept="image/*,application/pdf,video/mp4,video/webm,video/quicktime" required />
          <button className="adm-btn pri" type="submit">上傳</button>
        </div>
        <p className="adm-muted">圖片會自動轉為 WebP（最長邊 2000px、品質 80）；GIF、SVG、PDF、影片保留原檔。內容完全相同的檔案不會重複上傳。單次上傳上限約 4MB（Vercel 限制）。</p>
      </form>
      <form className="adm-filters" method="get">
        <input type="search" name="q" defaultValue={q} placeholder="搜尋檔名、標題、alt" />
        <select name="type" defaultValue={type}>
          <option value="">所有類型</option>
          <option value="image/">圖片</option>
          <option value="application/pdf">PDF</option>
          <option value="video/">影片</option>
        </select>
        <button className="adm-btn" type="submit">篩選</button>
      </form>
      <div className="adm-media-grid">
        {shown.map((m) => (
          <a key={m.id} href={`/admin/media/${m.id}/`} title={m.original_file || m.storage_path}>
            <div className="ph" style={String(m.mime_type || "").startsWith("image/") && m.public_url ? { backgroundImage: `url("${m.public_url}")` } : undefined}>
              {String(m.mime_type || "").startsWith("image/") && m.public_url ? "" : m.mime_type || "（未上傳）"}
            </div>
            <div className="cap">
              #{m.id} {m.title || m.storage_path}
              <br />
              <span className="adm-muted">{m.width ? `${m.width}×${m.height}・` : ""}{fmtBytes(m.bytes)}</span>
            </div>
          </a>
        ))}
      </div>
      <Pager total={total} offset={offset} limit={limit} href={(o) => `/admin/media/${qs({ q, type, offset: o })}`} />
    </>
  );
}
