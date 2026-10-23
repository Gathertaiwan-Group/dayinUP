import { notFound } from "next/navigation";
import { serviceDb } from "@/lib/supabase";
import { getRecord } from "@/lib/admin/service";
import { ENTITIES } from "@/lib/admin/entities";
import { fmtBytes, fmtDate } from "@/lib/admin/format";
import type { SP } from "@/lib/admin/loaders";
import { FieldSet, Flash } from "@/components/admin/Fields";
import { ConfirmButton } from "@/components/admin/Confirm";
import { deleteRecordAction, saveRecordAction } from "../../../actions";

export default async function MediaEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const m = await getRecord("media", Number(id));
  if (!m) notFound();
  const db = serviceDb();
  const [{ data: usedProducts }, { data: usedImages }, { data: usedPosts }] = await Promise.all([
    db.from("products").select("id,name").eq("featured_media_id", m.id).limit(20),
    db.from("product_images").select("product_id").eq("media_id", m.id).limit(20),
    db.from("posts").select("id,title").eq("featured_media_id", m.id).limit(20),
  ]);
  const isImg = String(m.mime_type || "").startsWith("image/");
  const here = `/admin/media/${id}/`;
  return (
    <>
      <h1 className="adm-h1">
        媒體 #{m.id} <a className="adm-btn sm" href="/admin/media/">回媒體庫</a>
      </h1>
      <Flash sp={sp} />
      <div className="adm-grid">
        <div className="adm-card">
          {isImg && m.public_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.public_url} alt={m.alt_text || ""} style={{ maxWidth: "100%", maxHeight: "70vh", display: "block", margin: "0 auto", background: "#f0f0f1" }} />
          ) : m.public_url ? (
            <p><a href={m.public_url} target="_blank" rel="noreferrer">開啟檔案 ↗</a></p>
          ) : (
            <p className="adm-muted">此項目尚未上傳檔案。</p>
          )}
        </div>
        <aside>
          <form action={saveRecordAction.bind(null, "media", id, here)} className="adm-card">
            <FieldSet fields={ENTITIES.media.fields} row={m} />
            <button className="adm-btn pri" type="submit">儲存</button>
          </form>
          <div className="adm-card">
            <p className="adm-muted" style={{ wordBreak: "break-all" }}>
              檔案網址：<input readOnly value={m.public_url || ""} aria-label="檔案網址" />
              <br />類型：{m.mime_type}
              <br />尺寸：{m.width ? `${m.width}×${m.height}` : "—"}
              <br />大小：{fmtBytes(m.bytes)}（原檔 {fmtBytes(m.meta?.original_filesize)}）
              <br />路徑：{m.storage_path || "—"}
              <br />上傳：{fmtDate(m.created_at)}
              {m.original_url ? <><br />舊網址：{m.original_url}</> : null}
              {m.attachment_path ? <><br />舊附件頁：{m.attachment_path}（301 → 檔案）</> : null}
            </p>
            <p className="adm-muted">
              使用於：
              {[...(usedProducts || []).map((p) => <a key={`p${p.id}`} href={`/admin/products/${p.id}/`}>{p.name} </a>), ...(usedImages || []).map((r) => <a key={`g${r.product_id}`} href={`/admin/products/${r.product_id}/`}>商品 #{r.product_id} </a>), ...(usedPosts || []).map((p) => <a key={`t${p.id}`} href={`/admin/content/${p.id}/`}>{p.title} </a>)]}
              {!usedProducts?.length && !usedImages?.length && !usedPosts?.length ? "（未被商品主圖／圖庫／精選圖片引用；內文引用未檢查）" : null}
            </p>
            <form action={deleteRecordAction.bind(null, "media", id, "/admin/media/")}>
              <input type="hidden" name="errorTo" value={here} />
              <ConfirmButton message="永久刪除此媒體與檔案？內文中引用此圖片的地方會失效。">永久刪除</ConfirmButton>
            </form>
          </div>
        </aside>
      </div>
    </>
  );
}
