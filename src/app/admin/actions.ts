"use server";

import { redirect } from "next/navigation";
import { authClient } from "@/lib/auth";
import { serviceDb } from "@/lib/supabase";
import { adminActor, getAdmin, requireAdmin } from "@/lib/admin/guard";
import { entityDef } from "@/lib/admin/entities";
import { fromLocalInput } from "@/lib/admin/format";
import {
  AdminError,
  addOrderNote,
  createRecord,
  deleteRecord,
  getRecord,
  restoreRecord,
  setObjectTerms,
  setProductImages,
  setSetting,
  updateOrderStatus,
  updateRecord,
  uploadMedia,
  type Actor,
} from "@/lib/admin/service";

type Row = Record<string, any>;

function msg(e: unknown) {
  if (e instanceof AdminError) return e.message;
  if (e instanceof Error) return `發生錯誤：${e.message}`;
  return "發生錯誤";
}

function withParam(path: string, key: string, val: string) {
  const u = new URL(path, "http://x");
  u.searchParams.delete("ok");
  u.searchParams.delete("error");
  u.searchParams.set(key, val);
  return u.pathname + u.search;
}

function safeReturn(p: unknown, fallback: string) {
  const s = typeof p === "string" ? p : "";
  return s.startsWith("/admin/") ? s : fallback;
}

async function actor(): Promise<Actor> {
  return adminActor(await requireAdmin());
}

/** 依表單上的 __fields（實際渲染的欄位）取值；checkbox 未勾＝false、datetime-local 以台北時間解讀 */
function readFields(entity: string, fd: FormData): Row {
  const def = entityDef(entity);
  const names = String(fd.get("__fields") || "").split(",").filter(Boolean);
  const out: Row = {};
  for (const name of names) {
    const f = def.fields.find((x) => x.name === name);
    if (!f || f.readonly) continue;
    if (f.type === "bool") out[name] = fd.get(name) === "on";
    else if (f.type === "datetime") out[name] = fromLocalInput(String(fd.get(name) || ""));
    else {
      const v = fd.get(name);
      if (v !== null) out[name] = String(v);
    }
  }
  return out;
}

// ---------- 登入／登出 ----------

export async function loginAction(_prev: { error?: string; email?: string } | undefined, fd: FormData): Promise<{ error?: string; email?: string }> {
  const email = String(fd.get("email") || "").trim();
  const password = String(fd.get("password") || "");
  if (!email || !password) return { error: "請輸入 Email 與密碼", email };
  const sb = await authClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "登入失敗：帳號或密碼錯誤", email };
  const { data: admin } = await serviceDb().from("admins").select("user_id,email").eq("user_id", data.user.id).maybeSingle();
  if (!admin) {
    await sb.auth.signOut();
    return { error: "此帳號沒有本站後台權限", email };
  }
  await serviceDb().from("audit_log").insert({ actor: admin.email, actor_user_id: data.user.id, via: "admin", action: "login", entity_type: "admins", entity_id: data.user.id });
  redirect("/admin/");
}

export async function logoutAction() {
  const sb = await authClient();
  await sb.auth.signOut();
  redirect("/admin/login/");
}

// ---------- 通用 ----------

export async function saveRecordAction(entity: string, id: string | null, returnTo: string, fd: FormData) {
  const a = await actor();
  let dest: string;
  try {
    const data = readFields(entity, fd);
    if (entity === "settings" && !id) data.key = String(fd.get("key") || "").trim();
    const row = id ? await updateRecord(entity, id, data, a) : await createRecord(entity, data, a);
    const def = entityDef(entity);
    dest = withParam(id ? safeReturn(returnTo, `/admin/e/${entity}/`) : `/admin/e/${entity}/${encodeURIComponent(String(row[def.pk]))}/`, "ok", "已儲存");
  } catch (e) {
    dest = withParam(safeReturn(returnTo, `/admin/e/${entity}/`), "error", msg(e));
  }
  redirect(dest);
}

export async function deleteRecordAction(entity: string, id: string, returnTo: string, fd: FormData) {
  const a = await actor();
  let dest: string;
  try {
    const r = await deleteRecord(entity, id, a, { force: fd.get("force") === "1" });
    dest = withParam(safeReturn(returnTo, `/admin/e/${entity}/`), "ok", "trashed" in r && r.trashed ? "已移到垃圾桶" : "已刪除");
  } catch (e) {
    dest = withParam(safeReturn(fd.get("errorTo") || returnTo, `/admin/e/${entity}/`), "error", msg(e));
  }
  redirect(dest);
}

export async function restoreAction(entity: "posts" | "products", id: string, returnTo: string) {
  const a = await actor();
  let dest: string;
  try {
    await restoreRecord(entity, id, a);
    dest = withParam(safeReturn(returnTo, "/admin/"), "ok", "已還原");
  } catch (e) {
    dest = withParam(safeReturn(returnTo, "/admin/"), "error", msg(e));
  }
  redirect(dest);
}

// ---------- 文章／頁面 ----------

export async function saveContentAction(id: string | null, fd: FormData) {
  const a = await actor();
  const intent = String(fd.get("intent") || "save");
  const back = id ? `/admin/content/${id}/` : `/admin/content/new/?type=${encodeURIComponent(String(fd.get("post_type") || "page"))}`;
  let dest: string;
  try {
    const data = readFields("posts", fd);
    const seo = { ...(id ? ((await getRecord("posts", id))?.seo as Row) || {} : {}) };
    for (const k of ["title", "description", "robots"]) {
      const v = fd.get(`seo_${k}`);
      if (v !== null) {
        if (String(v).trim()) seo[k] = String(v).trim();
        else delete seo[k];
      }
    }
    data.seo = seo;
    if (intent === "draft") data.status = "draft";
    else if (intent === "pending") data.status = "pending";
    else if (intent === "publish") {
      data.status = "publish";
      if (!data.date || Date.parse(data.date) > Date.now()) data.date = new Date().toISOString();
    } else if (intent === "schedule") {
      if (!data.date || Date.parse(data.date) <= Date.now()) throw new AdminError("排程請設定未來的發布時間");
      data.status = "future";
    }
    const row = id ? await updateRecord("posts", id, data, a) : await createRecord("posts", data, a);
    if (fd.get("__terms") === "1") {
      const termIds = fd.getAll("term_ids").map(Number);
      await setObjectTerms("post", row.id, termIds, a, ["category", "post_tag"]);
    }
    const label = { draft: "草稿已儲存", pending: "已送審", publish: "已發布", schedule: "已排程", preview: "已儲存，以下為預覽" }[intent] || "已更新";
    dest = intent === "preview" ? `/admin-preview/post/${row.id}/` : withParam(`/admin/content/${row.id}/`, "ok", label);
  } catch (e) {
    dest = withParam(back, "error", msg(e));
  }
  redirect(dest);
}

// ---------- 商品 ----------

export async function saveProductAction(id: string | null, fd: FormData) {
  const a = await actor();
  const intent = String(fd.get("intent") || "save");
  let dest: string;
  try {
    const data = readFields("products", fd);
    const seo = { ...(id ? ((await getRecord("products", id))?.seo as Row) || {} : {}) };
    for (const k of ["title", "description", "robots"]) {
      const v = fd.get(`seo_${k}`);
      if (v !== null) {
        if (String(v).trim()) seo[k] = String(v).trim();
        else delete seo[k];
      }
    }
    data.seo = seo;
    if (intent === "draft") data.status = "draft";
    else if (intent === "publish") {
      data.status = "publish";
      if (!data.date || Date.parse(data.date) > Date.now()) data.date = new Date().toISOString();
    } else if (intent === "schedule") {
      if (!data.date || Date.parse(data.date) <= Date.now()) throw new AdminError("排程請設定未來的發布時間");
      data.status = "future";
    }
    const row = id ? await updateRecord("products", id, data, a) : await createRecord("products", data, a);
    if (fd.get("__terms") === "1") await setObjectTerms("product", row.id, fd.getAll("term_ids").map(Number), a, ["product_cat", "product_tag", "product_brand"]);
    if (fd.has("gallery")) {
      const ids = String(fd.get("gallery") || "").split(",").filter(Boolean).map(Number);
      const { data: cur } = await serviceDb().from("product_images").select("media_id").eq("product_id", row.id).order("position");
      if ((cur || []).map((r) => r.media_id).join(",") !== ids.join(",")) await setProductImages(row.id, ids, a);
    }
    dest = intent === "preview" ? `/admin-preview/product/${row.id}/` : withParam(`/admin/products/${row.id}/`, "ok", "已儲存");
  } catch (e) {
    dest = withParam(id ? `/admin/products/${id}/` : "/admin/products/new/", "error", msg(e));
  }
  redirect(dest);
}

export async function saveProductOrderAction(fd: FormData) {
  const a = await actor();
  const back = safeReturn(fd.get("returnTo"), "/admin/products/");
  let dest: string;
  try {
    let n = 0;
    for (const [k, v] of fd.entries()) {
      const m = /^order_(\d+)$/.exec(k);
      if (!m) continue;
      const orig = fd.get(`orig_${m[1]}`);
      if (String(v) === String(orig)) continue;
      await updateRecord("products", m[1], { menu_order: Number(v) || 0 }, a, { action: "reorder" });
      n++;
    }
    dest = withParam(back, "ok", n ? `已更新 ${n} 件商品排序` : "排序沒有變更");
  } catch (e) {
    dest = withParam(back, "error", msg(e));
  }
  redirect(dest);
}

export async function saveChildAction(entity: "product_variations" | "product_attributes" | "discount_rules", productId: string, childId: string | null, fd: FormData) {
  const a = await actor();
  const back = `/admin/products/${productId}/`;
  let dest: string;
  try {
    const data = readFields(entity, fd);
    data.product_id = Number(productId);
    if (childId) {
      const cur = await getRecord(entity, childId);
      if (!cur || Number(cur.product_id) !== Number(productId)) throw new AdminError("資料不屬於此商品");
      await updateRecord(entity, childId, data, a);
    } else await createRecord(entity, data, a);
    dest = withParam(back, "ok", "已儲存");
  } catch (e) {
    dest = withParam(back, "error", msg(e));
  }
  redirect(dest + (entity === "product_variations" ? "#variations" : entity === "discount_rules" ? "#discounts" : "#attributes"));
}

export async function deleteChildAction(entity: "product_variations" | "product_attributes" | "discount_rules", productId: string, childId: string) {
  const a = await actor();
  const back = `/admin/products/${productId}/`;
  let dest: string;
  try {
    const cur = await getRecord(entity, childId);
    if (!cur || Number(cur.product_id) !== Number(productId)) throw new AdminError("資料不屬於此商品");
    await deleteRecord(entity, childId, a);
    dest = withParam(back, "ok", "已刪除");
  } catch (e) {
    dest = withParam(back, "error", msg(e));
  }
  redirect(dest);
}

// ---------- 訂單 ----------

export async function orderStatusAction(orderId: string, fd: FormData) {
  const a = await actor();
  const back = `/admin/orders/${orderId}/`;
  let dest: string;
  try {
    await updateOrderStatus(Number(orderId), String(fd.get("status") || ""), a, String(fd.get("note") || "").trim() || null);
    dest = withParam(back, "ok", "訂單狀態已更新");
  } catch (e) {
    dest = withParam(back, "error", msg(e));
  }
  redirect(dest);
}

export async function orderNoteAction(orderId: string, fd: FormData) {
  const a = await actor();
  const back = `/admin/orders/${orderId}/`;
  let dest: string;
  try {
    await addOrderNote(Number(orderId), String(fd.get("note") || ""), a, fd.get("is_customer_note") === "on");
    dest = withParam(back, "ok", "已新增備註");
  } catch (e) {
    dest = withParam(back, "error", msg(e));
  }
  redirect(dest);
}

export async function orderDetailsAction(orderId: string, fd: FormData) {
  const a = await actor();
  const back = `/admin/orders/${orderId}/`;
  let dest: string;
  try {
    const data = readFields("orders", fd);
    delete data.status; // 狀態請用狀態更新（會留訂單備註）
    const cur = await getRecord("orders", orderId);
    if (!cur) throw new AdminError("找不到訂單");
    for (const kind of ["billing", "shipping"] as const) {
      const obj: Row = { ...(cur[kind] || {}) };
      let touched = false;
      for (const [k, v] of fd.entries()) {
        const m = new RegExp(`^${kind}__(\\w+)$`).exec(k);
        if (!m) continue;
        touched = true;
        const val = String(v).trim();
        if (val) obj[m[1]] = val;
        else delete obj[m[1]];
      }
      if (touched) data[kind] = obj;
    }
    if (data.billing && "email" in data.billing) data.billing_email = data.billing.email || null;
    await updateRecord("orders", orderId, data, a);
    dest = withParam(back, "ok", "訂單資料已儲存");
  } catch (e) {
    dest = withParam(back, "error", msg(e));
  }
  redirect(dest);
}

// ---------- 媒體 ----------

export async function uploadMediaAction(fd: FormData) {
  const a = await actor();
  let dest: string;
  try {
    const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f && f.size > 0);
    if (!files.length) throw new AdminError("請選擇檔案");
    let ok = 0;
    let dup = 0;
    for (const f of files) {
      const r = await uploadMedia({ filename: f.name, bytes: Buffer.from(await f.arrayBuffer()), mime: f.type }, a);
      if ((r as Row).duplicate) dup++;
      else ok++;
    }
    dest = withParam("/admin/media/", "ok", `已上傳 ${ok} 個檔案${dup ? `（${dup} 個與既有檔案相同，未重複上傳）` : ""}`);
  } catch (e) {
    dest = withParam("/admin/media/", "error", msg(e));
  }
  redirect(dest);
}

export type PickerItem = { id: number; url: string; title: string; mime: string; width: number | null; height: number | null };

/** 媒體挑選器（所見即所得插圖、商品圖庫）：回傳資料，不轉址 */
export async function pickerMediaAction(q: string, offset = 0): Promise<{ items: PickerItem[]; total: number }> {
  if (!(await getAdmin())) return { items: [], total: 0 };
  let query = serviceDb()
    .from("media")
    .select("id,title,public_url,mime_type,width,height,storage_path", { count: "exact" })
    .not("public_url", "is", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  const term = q.replace(/[,()*\\%_"]/g, " ").trim();
  if (term) query = query.or(`title.ilike.*${term}*,storage_path.ilike.*${term}*,alt_text.ilike.*${term}*`);
  const { data, count } = await query.range(offset, offset + 59);
  return {
    total: count || 0,
    items: (data || []).map((m) => ({ id: m.id, url: m.public_url, title: m.title || m.storage_path, mime: m.mime_type || "", width: m.width, height: m.height })),
  };
}

export async function uploadInlineAction(fd: FormData): Promise<{ item?: PickerItem; error?: string }> {
  const s = await getAdmin();
  if (!s) return { error: "請重新登入" };
  try {
    const f = fd.get("file");
    if (!f || typeof f !== "object" || !("arrayBuffer" in f)) throw new AdminError("請選擇檔案");
    const r = await uploadMedia({ filename: f.name, bytes: Buffer.from(await f.arrayBuffer()), mime: f.type }, await adminActor(s));
    return { item: { id: r.id, url: r.public_url, title: r.title || "", mime: r.mime_type, width: r.width, height: r.height } };
  } catch (e) {
    return { error: msg(e) };
  }
}

// ---------- 選單 ----------

export async function saveMenuItemsAction(menuId: string, fd: FormData) {
  const a = await actor();
  const back = `/admin/menus/${menuId}/`;
  let dest: string;
  try {
    const ids = String(fd.get("__items") || "").split(",").filter(Boolean);
    for (const id of ids) {
      const cur = await getRecord("menu_items", id);
      if (!cur || String(cur.menu_id) !== String(menuId)) continue;
      if (fd.get(`del_${id}`) === "on") {
        await deleteRecord("menu_items", id, a);
        continue;
      }
      const patch: Row = {
        label: String(fd.get(`title_${id}`) || ""),
        url: String(fd.get(`url_${id}`) || ""),
        position: Number(fd.get(`position_${id}`) || 0),
        parent_id: String(fd.get(`parent_${id}`) || ""),
        target: String(fd.get(`target_${id}`) || ""),
        object_type: String(fd.get(`type_${id}`) || ""),
        object_id: String(fd.get(`oid_${id}`) || ""),
        classes: String(fd.get(`css_${id}`) || ""),
      };
      if (patch.parent_id === id) patch.parent_id = "";
      await updateRecord("menu_items", id, patch, a);
    }
    const newTitle = String(fd.get("new_title") || "").trim();
    const newUrl = String(fd.get("new_url") || "").trim();
    if (newTitle || newUrl) {
      await createRecord(
        "menu_items",
        {
          menu_id: Number(menuId),
          label: newTitle,
          url: newUrl,
          position: Number(fd.get("new_position") || ids.length),
          parent_id: String(fd.get("new_parent") || ""),
          target: String(fd.get("new_target") || ""),
          object_type: String(fd.get("new_type") || "custom"),
          object_id: String(fd.get("new_oid") || ""),
          classes: null,
        },
        a,
      );
    }
    dest = withParam(back, "ok", "選單已儲存");
  } catch (e) {
    dest = withParam(back, "error", msg(e));
  }
  redirect(dest);
}

// ---------- 表單提交 ----------

export async function submissionStatusAction(formId: string, fd: FormData) {
  const a = await actor();
  const back = safeReturn(fd.get("returnTo"), `/admin/forms/${formId}/`);
  let dest: string;
  try {
    const ids = fd.getAll("ids").map(String);
    const status = String(fd.get("status") || "");
    if (!ids.length) throw new AdminError("請勾選提交紀錄");
    for (const id of ids) {
      const cur = await getRecord("form_submissions", id);
      if (!cur || String(cur.form_id) !== String(formId)) continue;
      if (status === "delete") await deleteRecord("form_submissions", id, a);
      else await updateRecord("form_submissions", id, { status }, a);
    }
    dest = withParam(back, "ok", `已更新 ${ids.length} 筆`);
  } catch (e) {
    dest = withParam(back, "error", msg(e));
  }
  redirect(dest);
}

// ---------- 網站設定 ----------

export async function saveSettingsAction(fd: FormData) {
  const a = await actor();
  let dest: string;
  try {
    const get = (k: string) => String(fd.get(k) || "").trim();
    const cur = Object.fromEntries((await serviceDb().from("settings").select("key,value")).data?.map((r) => [r.key, r.value]) || []);
    const mediaUrl = async (id: string) => {
      if (!id) return null;
      const m = await getRecord("media", id);
      if (!m) throw new AdminError(`找不到媒體 #${id}`);
      return m.public_url as string;
    };
    const logoId = get("logo_media_id");
    const iconId = get("icon_media_id");
    const contact = { ...(cur.contact || {}), email: get("contact_email"), phone: get("contact_phone"), line: get("contact_line"), address: get("contact_address") };
    const social = { ...(cur.social || {}), facebook: get("social_facebook"), instagram: get("social_instagram"), youtube: get("social_youtube"), line: get("social_line") };
    const codes = {
      gtag_id: get("tracking_gtag"),
      amplitude_key: get("tracking_amplitude"),
      cloudflare_token: get("tracking_cloudflare"),
      hubspot: fd.get("tracking_hubspot") === "on",
      custom_head_html: String(fd.get("tracking_custom") || ""),
    };
    for (const v of [codes.gtag_id, codes.amplitude_key, codes.cloudflare_token]) if (v && !/^[\w-]+$/.test(v)) throw new AdminError(`追蹤碼格式錯誤：${v}`);
    const changes: [string, unknown][] = [
      ["site.title", get("site_name")],
      ["site.tagline", get("site_description")],
      ["site.logo_media_id", logoId ? Number(logoId) : null],
      ["site.logo_url", await mediaUrl(logoId)],
      ["site.icon_media_id", iconId ? Number(iconId) : null],
      ["site.icon_url", await mediaUrl(iconId)],
      ["contact", contact],
      ["social", social],
      ["tracking.codes", codes],
      ["footer.copyright", get("footer_copyright")],
    ];
    for (const [k, v] of changes) if (JSON.stringify(cur[k] ?? null) !== JSON.stringify(v ?? null)) await setSetting(k, v, a, true);
    dest = withParam("/admin/settings/", "ok", "設定已儲存");
  } catch (e) {
    dest = withParam("/admin/settings/", "error", msg(e));
  }
  redirect(dest);
}
