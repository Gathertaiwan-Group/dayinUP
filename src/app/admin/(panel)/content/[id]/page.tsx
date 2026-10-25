import { requireAdmin } from "@/lib/admin/guard";
import { notFound } from "next/navigation";
import { serviceDb } from "@/lib/supabase";
import { getPostFull } from "@/lib/admin/service";
import { ENTITIES, POST_STATUS_LABEL } from "@/lib/admin/entities";
import { decodeSlugSafe, fmtDate, toLocalInput } from "@/lib/admin/format";
import { allTerms, mediaMap, sp1, type SP } from "@/lib/admin/loaders";
import { FieldInput, Flash, Badge } from "@/components/admin/Fields";
import { ConfirmButton } from "@/components/admin/Confirm";
import { deleteRecordAction, saveContentAction } from "../../../actions";

const TYPE_LABEL: Record<string, string> = { post: "文章", page: "頁面", ct_content_block: "內容區塊", wp_block: "可重複使用區塊", wp_navigation: "導覽", elementor_library: "Elementor 範本" };

export default async function ContentEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === "new";
  const post = isNew ? null : await getPostFull(Number(id));
  if (!isNew && !post) notFound();
  const type = post?.post_type || (TYPE_LABEL[sp1(sp, "type")] ? sp1(sp, "type") : "page");
  const F = Object.fromEntries(ENTITIES.posts.fields.map((f) => [f.name, f]));
  const media = await mediaMap([post?.featured_media_id]);
  const terms = type === "post" ? await allTerms(["category", "post_tag"]) : [];
  const { data: parents } = type === "page" ? await serviceDb().from("posts").select("id,title,path").eq("post_type", "page").neq("status", "trash").order("title") : { data: [] as any[] };
  const selected = new Set((post?.terms || []).map((t: any) => t?.id));
  const seo = (post?.seo || {}) as Record<string, any>;
  const status = post?.status || "draft";
  const fieldNames = ["title", "slug", "content_html", "excerpt_html", "menu_order", "featured_media_id", "template", "comment_status", "password", "path", "date", ...(type === "page" ? ["parent_id"] : []), ...(type === "post" ? ["sticky"] : [])];
  if (isNew) fieldNames.push("post_type");

  return (
    <form action={saveContentAction.bind(null, isNew ? null : id)}>
      <input type="hidden" name="__fields" value={fieldNames.join(",")} />
      {isNew ? <input type="hidden" name="post_type" value={type} /> : null}
      <h1 className="adm-h1">
        {isNew ? `新增${TYPE_LABEL[type] || type}` : `編輯${TYPE_LABEL[type] || type}`}
        {!isNew ? <Badge v={status} /> : null}
        <a className="adm-btn sm" href={`/admin/content/?type=${type}`}>回列表</a>
      </h1>
      <Flash sp={sp} />
      <div className="adm-grid">
        <div>
          <div className="adm-card">
            <div className="adm-field">
              <input className="adm-title" name="title" defaultValue={post?.title || ""} placeholder="輸入標題" aria-label="標題" />
            </div>
            <div className="adm-cols2">
              <FieldInput f={{ ...F.slug, help: post ? `目前：${decodeSlugSafe(post.slug)}` : "留空依標題自動產生" }} row={post ? { ...post, slug: decodeSlugSafe(post.slug) } : null} />
              <FieldInput f={F.path} row={post ? { ...post, path: decodeSlugSafe(post.path) } : null} />
            </div>
            <FieldInput f={F.content_html} row={post} />
            {post?.meta?._elementor_data || /elementor|data-stk|wp-block-stackable/.test(String(post?.content_html || "")) ? <p className="adm-help">此內容由 Elementor／Stackable 版面產生，所見即所得編輯會保留原始 HTML 結構；大幅改版建議切換「HTML」模式編輯。</p> : null}
          </div>
          <div className="adm-card">
            <h2 className="adm-h2">摘要與 SEO</h2>
            <FieldInput f={F.excerpt_html} row={post} />
            <div className="adm-field">
              <label htmlFor="seo_title">SEO 標題</label>
              <input id="seo_title" name="seo_title" defaultValue={seo.title || ""} />
            </div>
            <div className="adm-field">
              <label htmlFor="seo_description">SEO 描述</label>
              <textarea id="seo_description" name="seo_description" className="plain" defaultValue={seo.description || ""} rows={2} />
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
              {post?.date ? <><br />{status === "future" ? "排程於" : "發布於"} {fmtDate(post.date)}</> : null}
              {post?.updated_at ? <><br />最後修改 {fmtDate(post.updated_at)}</> : null}
            </p>
            <div className="adm-field">
              <label htmlFor="date">發布時間（排程請設未來時間）</label>
              <input type="datetime-local" id="date" name="date" defaultValue={toLocalInput(post?.date)} />
            </div>
            <div className="adm-row">
              <button className="adm-btn" type="submit" name="intent" value="draft">儲存草稿</button>
              <button className="adm-btn" type="submit" name="intent" value="preview">儲存並預覽</button>
              {!isNew ? <a className="adm-btn" href={`/admin-preview/post/${id}/`} target="_blank" rel="noreferrer">預覽 ↗</a> : null}
            </div>
            <div className="adm-row adm-mt">
              <button className="adm-btn pri" type="submit" name="intent" value="publish">{status === "publish" ? "更新" : "發布"}</button>
              <button className="adm-btn" type="submit" name="intent" value="schedule">排程</button>
              {!isNew && status !== "draft" && status !== "publish" ? <button className="adm-btn" type="submit" name="intent" value="save">儲存</button> : null}
            </div>
            {status === "publish" && post?.path ? (
              <p className="adm-mt">
                <a href={post.path} target="_blank" rel="noreferrer">檢視{TYPE_LABEL[type]} ↗</a>
              </p>
            ) : null}
          </div>
          {type === "page" ? (
            <div className="adm-card">
              <h2 className="adm-h2">頁面屬性</h2>
              <div className="adm-field">
                <label htmlFor="parent_id">上層頁面</label>
                <select id="parent_id" name="parent_id" defaultValue={post?.parent_id ? String(post.parent_id) : ""}>
                  <option value="">（無）</option>
                  {(parents || []).filter((p: any) => p.id !== post?.id).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.title}（{decodeSlugSafe(p.path)}）</option>
                  ))}
                </select>
              </div>
              <FieldInput f={F.template} row={post} />
              <FieldInput f={F.menu_order} row={post} />
            </div>
          ) : (
            <input type="hidden" name="menu_order" value={post?.menu_order ?? 0} />
          )}
          {type !== "page" ? <><input type="hidden" name="template" value={post?.template ?? ""} /></> : null}
          {type === "post" ? (
            <div className="adm-card">
              <input type="hidden" name="__terms" value="1" />
              <h2 className="adm-h2">分類與標籤</h2>
              {["category", "post_tag"].map((tax) => (
                <div key={tax} className="adm-field">
                  <label>{tax === "category" ? "分類" : "標籤"}</label>
                  {terms.filter((t) => t.taxonomy === tax).map((t) => (
                    <div key={t.id}>
                      <label className="adm-check"><input type="checkbox" name="term_ids" value={t.id} defaultChecked={selected.has(t.id)} /> {t.name}</label>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          <div className="adm-card">
            <h2 className="adm-h2">精選圖片</h2>
            <FieldInput f={{ ...F.featured_media_id, label: "" }} row={post} ctx={{ media }} />
          </div>
          <div className="adm-card">
            <h2 className="adm-h2">其他</h2>
            <FieldInput f={F.comment_status} row={post || { comment_status: "closed" }} />
            <FieldInput f={F.password} row={post} />
            {type === "post" ? <FieldInput f={F.sticky} row={post} /> : null}
          </div>
          {!isNew ? (
            <div className="adm-card">
              <ConfirmButton message="移到垃圾桶？" formAction={deleteRecordAction.bind(null, "posts", id, `/admin/content/?type=${type}`)}>
                移到垃圾桶
              </ConfirmButton>
            </div>
          ) : null}
        </aside>
      </div>
    </form>
  );
}

