/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { serviceDb } from "@/lib/supabase";
import { ENTITIES, ORDER_STATUS_LABEL } from "@/lib/admin/entities";
import {
  AdminError,
  addOrderNote,
  adjustStock,
  createRecord,
  deleteRecord,
  getOrderFull,
  getPostFull,
  getProductFull,
  getRecord,
  getSettings,
  listRecords,
  restoreRecord,
  setObjectTerms,
  setPrice,
  setProductImages,
  setSetting,
  updateOrderStatus,
  updateRecord,
  uploadMedia,
  type Actor,
} from "@/lib/admin/service";

type Row = Record<string, any>;

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function err(e: unknown) {
  const message = e instanceof AdminError ? e.message : e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text" as const, text: `錯誤：${message}` }], isError: true };
}
async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e);
  }
}

const POST_LIST_COLS = "id,post_type,title,slug,status,path,menu_order,parent_id,author_id,date,modified,updated_at";
const PRODUCT_LIST_COLS = "id,name,slug,sku,status,type,price,price_min,price_max,regular_price,sale_price,on_sale,stock_status,stock_quantity,manage_stock,menu_order,featured,path,date,updated_at";

/** 通用工具可操作的資料表（文章、商品等有專用工具） */
const GENERIC = ["terms", "attributes", "product_variations", "product_attributes", "customers", "coupons", "discount_rules", "media", "menus", "menu_items", "forms", "form_submissions", "redirects", "order_notes"] as const;

const listShape = {
  search: z.string().optional().describe("關鍵字（標題／代稱等模糊搜尋）"),
  limit: z.number().int().min(1).max(200).optional().describe("筆數，預設 20"),
  offset: z.number().int().min(0).optional(),
};

export function buildMcpServer(actor: Actor) {
  const server = new McpServer(
    { name: "dayinup-admin", version: "1.0.0" },
    {
      instructions:
        "DayinUP（dayinup.com 搬遷版）網站管理工具。資料欄位對齊 WordPress / WooCommerce。" +
        "新增內容預設為草稿（status=draft）；刪除文章／商品預設移到垃圾桶（force=true 才永久刪除）。所有寫入都會記錄到稽核紀錄。" +
        "價格單位為新台幣（TWD）。本站未串接金流（舊站為藍新 NewebPay），訂單由前台建立為 pending（待付款）。可變商品的變體＝票種（早鳥／2 人同行／3 人同行等），團報折扣規則在 discount_rules。",
    },
  );

  // ---------- 文章／頁面 ----------
  server.registerTool(
    "list_posts",
    {
      title: "列出文章／頁面",
      description: "列出文章（post）、頁面（page）或內容區塊（ct_content_block）。",
      inputSchema: { post_type: z.enum(["post", "page", "ct_content_block", "wp_block", "wp_navigation", "elementor_library"]).optional(), status: z.enum(["publish", "draft", "pending", "private", "future", "trash"]).optional(), ...listShape },
    },
    async ({ post_type, status, search, limit, offset }) =>
      run(() => listRecords("posts", { q: search, filters: { post_type, status }, limit: limit ?? 20, offset, columns: POST_LIST_COLS })),
  );
  server.registerTool(
    "get_post",
    { title: "讀取文章／頁面", description: "依 ID 讀取完整文章／頁面（含內容 HTML、SEO、分類）。", inputSchema: { id: z.number().int() } },
    async ({ id }) =>
      run(async () => {
        const p = await getPostFull(id);
        if (!p) throw new AdminError(`找不到文章 #${id}`);
        return p;
      }),
  );
  const postFields = {
    title: z.string().optional(),
    content_html: z.string().optional().describe("HTML 內容"),
    excerpt_html: z.string().optional().describe("摘要 HTML"),
    slug: z.string().optional().describe("留空依標題自動產生"),
    status: z.enum(["draft", "pending", "private", "publish", "future"]).optional(),
    date: z.string().optional().describe("發布時間 ISO 8601；status=future 時為排程時間"),
    author_id: z.number().int().nullable().optional(),
    comment_status: z.enum(["open", "closed"]).optional(),
    sticky: z.boolean().optional(),
    password: z.string().nullable().optional(),
    parent_id: z.number().int().nullable().optional(),
    menu_order: z.number().int().optional(),
    featured_media_id: z.number().int().nullable().optional(),
    template: z.string().optional(),
    path: z.string().optional().describe("頁面網址路徑，如 /about/；留空自動產生"),
    seo: z.record(z.string(), z.any()).optional().describe("Rank Math SEO：{ title, description, robots, og_title, og_description, og_image, ... }"),
    term_ids: z.array(z.number().int()).optional().describe("文章分類／標籤 ID（category / post_tag）"),
  };
  server.registerTool(
    "create_post",
    {
      title: "新增文章／頁面",
      description: "新增文章或頁面，預設為草稿。",
      inputSchema: { post_type: z.enum(["post", "page", "ct_content_block"]).default("post"), ...postFields, title: z.string() },
    },
    async ({ term_ids, ...data }) =>
      run(async () => {
        const row = await createRecord("posts", { ...data, status: data.status ?? "draft" }, actor);
        if (term_ids) await setObjectTerms("post", row.id, term_ids, actor, ["category", "post_tag"]);
        return row;
      }),
  );
  server.registerTool(
    "update_post",
    { title: "修改文章／頁面", description: "修改指定欄位（只傳要改的欄位）。", inputSchema: { id: z.number().int(), ...postFields } },
    async ({ id, term_ids, ...data }) =>
      run(async () => {
        const row = await updateRecord("posts", id, data, actor);
        if (term_ids) await setObjectTerms("post", id, term_ids, actor, ["category", "post_tag"]);
        return row;
      }),
  );
  server.registerTool(
    "delete_post",
    {
      title: "刪除文章／頁面",
      description: "預設移到垃圾桶；force=true 永久刪除（垃圾桶中的項目再刪一次也會永久刪除）。",
      inputSchema: { id: z.number().int(), force: z.boolean().optional() },
    },
    async ({ id, force }) => run(() => deleteRecord("posts", id, actor, { force })),
  );
  server.registerTool(
    "restore_post",
    { title: "還原文章／頁面", description: "從垃圾桶還原到刪除前的狀態。", inputSchema: { id: z.number().int() } },
    async ({ id }) => run(() => restoreRecord("posts", id, actor)),
  );

  // ---------- 商品 ----------
  server.registerTool(
    "list_products",
    {
      title: "列出商品",
      description: "列出商品（活動票券；新到舊）。",
      inputSchema: { status: z.enum(["publish", "draft", "pending", "private", "future", "trash"]).optional(), stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(), ...listShape },
    },
    async ({ status, stock_status, search, limit, offset }) =>
      run(() => listRecords("products", { q: search, filters: { status, stock_status }, limit: limit ?? 20, offset, columns: PRODUCT_LIST_COLS })),
  );
  server.registerTool(
    "get_product",
    { title: "讀取商品", description: "讀取商品完整資料（含圖片、分類、屬性、變體）。", inputSchema: { id: z.number().int() } },
    async ({ id }) =>
      run(async () => {
        const p = await getProductFull(id);
        if (!p) throw new AdminError(`找不到商品 #${id}`);
        return p;
      }),
  );
  const productFields = {
    name: z.string().optional(),
    slug: z.string().optional(),
    status: z.enum(["draft", "pending", "private", "publish", "future"]).optional(),
    type: z.enum(["simple", "variable", "grouped", "external"]).optional(),
    sku: z.string().nullable().optional(),
    description_html: z.string().optional().describe("商品說明 HTML"),
    short_description_html: z.string().optional().describe("商品簡短說明 HTML"),
    regular_price: z.number().nullable().optional(),
    sale_price: z.number().nullable().optional(),
    date_on_sale_from: z.string().nullable().optional(),
    date_on_sale_to: z.string().nullable().optional(),
    manage_stock: z.boolean().optional(),
    stock_quantity: z.number().int().nullable().optional(),
    stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
    backorders: z.enum(["no", "notify", "yes"]).optional(),
    featured: z.boolean().optional(),
    catalog_visibility: z.enum(["visible", "catalog", "search", "hidden"]).optional(),
    menu_order: z.number().int().optional().describe("自訂排序（越小越前）"),
    sold_individually: z.boolean().optional(),
    is_purchasable: z.boolean().optional(),
    virtual: z.boolean().optional(),
    weight: z.string().nullable().optional(),
    featured_media_id: z.number().int().nullable().optional(),
    date: z.string().optional().describe("發布時間 ISO 8601；status=future 時為排程時間"),
    seo: z.record(z.string(), z.any()).optional(),
    term_ids: z.array(z.number().int()).optional().describe("商品分類／標籤 ID（product_cat / product_tag），會取代原有設定"),
    image_ids: z.array(z.number().int()).optional().describe("商品圖片 media ID，第一張為主圖，會取代原有設定"),
  };
  server.registerTool(
    "create_product",
    { title: "新增商品", description: "新增商品，預設為草稿。", inputSchema: { ...productFields, name: z.string() } },
    async ({ term_ids, image_ids, ...data }) =>
      run(async () => {
        const row = await createRecord("products", { ...data, status: data.status ?? "draft" }, actor);
        if (term_ids) await setObjectTerms("product", row.id, term_ids, actor, ["product_cat", "product_tag"]);
        if (image_ids) await setProductImages(row.id, image_ids, actor);
        return getProductFull(row.id);
      }),
  );
  server.registerTool(
    "update_product",
    { title: "修改商品", description: "修改商品欄位（只傳要改的欄位）。", inputSchema: { id: z.number().int(), ...productFields } },
    async ({ id, term_ids, image_ids, ...data }) =>
      run(async () => {
        await updateRecord("products", id, data, actor);
        if (term_ids) await setObjectTerms("product", id, term_ids, actor, ["product_cat", "product_tag"]);
        if (image_ids) await setProductImages(id, image_ids, actor);
        return getProductFull(id);
      }),
  );
  server.registerTool(
    "delete_product",
    { title: "刪除商品", description: "預設移到垃圾桶；force=true 永久刪除。", inputSchema: { id: z.number().int(), force: z.boolean().optional() } },
    async ({ id, force }) => run(() => deleteRecord("products", id, actor, { force })),
  );
  server.registerTool(
    "set_product_price",
    {
      title: "調整價格",
      description: "設定商品或變體的原價／特價（特價可設期間）。sale_price 傳 null 取消特價。",
      inputSchema: {
        product_id: z.number().int(),
        variation_id: z.number().int().optional(),
        regular_price: z.number().nullable().optional(),
        sale_price: z.number().nullable().optional(),
        date_on_sale_from: z.string().nullable().optional(),
        date_on_sale_to: z.string().nullable().optional(),
      },
    },
    async ({ product_id, variation_id, ...p }) => run(() => setPrice({ product_id, variation_id }, p, actor)),
  );
  server.registerTool(
    "adjust_stock",
    {
      title: "調整庫存",
      description: "設定庫存數量（set）或增減（delta），或直接設定庫存狀態。設定數量會自動啟用庫存管理並更新庫存狀態。",
      inputSchema: {
        product_id: z.number().int(),
        variation_id: z.number().int().optional(),
        set: z.number().int().optional(),
        delta: z.number().int().optional(),
        stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
        manage_stock: z.boolean().optional(),
      },
    },
    async ({ product_id, variation_id, ...p }) => run(() => adjustStock({ product_id, variation_id }, p, actor)),
  );
  server.registerTool(
    "reorder_products",
    {
      title: "商品排序",
      description: "依給定的商品 ID 順序重設自訂排序（menu_order = 0,1,2…；前台預設排序）。未列出的商品不變。",
      inputSchema: { product_ids: z.array(z.number().int()).min(1) },
    },
    async ({ product_ids }) =>
      run(async () => {
        const changed: number[] = [];
        for (const [i, id] of product_ids.entries()) {
          const cur = await getRecord("products", id);
          if (!cur) throw new AdminError(`找不到商品 #${id}`);
          if (cur.menu_order !== i) {
            await updateRecord("products", id, { menu_order: i }, actor, { action: "reorder" });
            changed.push(id);
          }
        }
        return { changed };
      }),
  );

  // ---------- 分類 ----------
  server.registerTool(
    "list_terms",
    {
      title: "列出分類／標籤",
      description: "列出商品分類（product_cat）、商品標籤（product_tag）、品牌（product_brand）、文章分類（category）、文章標籤（post_tag）。",
      inputSchema: { taxonomy: z.string().optional(), ...listShape },
    },
    async ({ taxonomy, search, limit, offset }) => run(() => listRecords("terms", { q: search, filters: { taxonomy }, limit: limit ?? 100, offset })),
  );
  const termFields = {
    name: z.string().optional(),
    slug: z.string().optional(),
    description: z.string().optional(),
    parent_id: z.number().int().nullable().optional(),
    menu_order: z.number().int().optional(),
    image_media_id: z.number().int().nullable().optional(),
    path: z.string().nullable().optional().describe("留空自動依分類法產生（/product-category/…/）"),
    meta: z.record(z.string(), z.any()).optional(),
  };
  server.registerTool(
    "create_term",
    { title: "新增分類／標籤", description: "新增分類或標籤。", inputSchema: { taxonomy: z.string(), ...termFields, name: z.string() } },
    async (data) => run(() => createRecord("terms", data, actor)),
  );
  server.registerTool(
    "update_term",
    { title: "修改分類／標籤", description: "修改分類或標籤。", inputSchema: { id: z.number().int(), ...termFields } },
    async ({ id, ...data }) => run(() => updateRecord("terms", id, data, actor)),
  );
  server.registerTool(
    "delete_term",
    { title: "刪除分類／標籤", description: "刪除分類或標籤（商品／文章的關聯一併移除）。", inputSchema: { id: z.number().int() } },
    async ({ id }) => run(() => deleteRecord("terms", id, actor)),
  );
  server.registerTool(
    "set_object_terms",
    {
      title: "設定商品／文章分類",
      description: "設定商品（product）或文章（post）的分類與標籤（取代原設定）。",
      inputSchema: { kind: z.enum(["product", "post"]), id: z.number().int(), term_ids: z.array(z.number().int()) },
    },
    async ({ kind, id, term_ids }) =>
      run(() => setObjectTerms(kind, id, term_ids, actor, kind === "product" ? ["product_cat", "product_tag"] : ["category", "post_tag"])),
  );

  // ---------- 媒體 ----------
  server.registerTool(
    "list_media",
    { title: "列出媒體", description: "列出媒體庫檔案。", inputSchema: { mime_type: z.string().optional().describe("如 image/webp"), ...listShape } },
    async ({ mime_type, search, limit, offset }) =>
      run(() =>
        listRecords("media", {
          q: search,
          filters: { mime_type },
          limit: limit ?? 20,
          offset,
          columns: "id,title,alt_text,mime_type,public_url,storage_path,original_file,width,height,bytes,parent_id,created_at",
        }),
      ),
  );
  server.registerTool(
    "upload_media",
    {
      title: "上傳媒體",
      description: "上傳檔案到媒體庫（base64 或 http(s) 網址擇一）。圖片自動轉 WebP（最長邊 2000、品質 80）；GIF／SVG／PDF／影片保留原檔；相同內容不重複上傳。",
      inputSchema: {
        filename: z.string().describe("檔名，如 bottle.jpg"),
        base64: z.string().optional(),
        url: z.string().url().optional(),
        mime_type: z.string().optional(),
        title: z.string().optional(),
        alt_text: z.string().optional(),
        parent_post_id: z.number().int().optional(),
      },
    },
    async ({ filename, base64, url, mime_type, title, alt_text, parent_post_id }) =>
      run(async () => {
        let bytes: Buffer;
        let mime = mime_type || null;
        if (base64) bytes = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64");
        else if (url) {
          if (!/^https?:\/\//i.test(url)) throw new AdminError("只接受 http(s) 網址");
          const r = await fetch(url, { headers: { "User-Agent": "GatherMigrator/1.0" }, redirect: "follow" });
          if (!r.ok) throw new AdminError(`下載失敗：HTTP ${r.status}`);
          const len = Number(r.headers.get("content-length") || 0);
          if (len > 50 * 1024 * 1024) throw new AdminError("檔案超過 50MB");
          bytes = Buffer.from(await r.arrayBuffer());
          mime = mime || r.headers.get("content-type")?.split(";")[0] || null;
        } else throw new AdminError("請提供 base64 或 url");
        return uploadMedia({ filename, bytes, mime, title, alt_text, parent_post_id }, actor);
      }),
  );

  // ---------- 訂單 ----------
  server.registerTool(
    "list_orders",
    {
      title: "列出訂單",
      description: "依狀態、顧客或關鍵字（Email、交易編號、order_key）查詢訂單。",
      inputSchema: { status: z.enum(Object.keys(ORDER_STATUS_LABEL) as [string, ...string[]]).optional(), customer_id: z.number().int().optional(), ...listShape },
    },
    async ({ status, customer_id, search, limit, offset }) =>
      run(() =>
        listRecords("orders", {
          q: search,
          filters: { status, customer_id },
          limit: limit ?? 20,
          offset,
          columns: "id,status,type,customer_id,billing_email,billing,total,currency,payment_method,payment_method_title,coupon_codes,date_created,date_paid",
        }),
      ),
  );
  server.registerTool(
    "get_order",
    { title: "讀取訂單", description: "讀取訂單明細（品項、備註、退款）。", inputSchema: { id: z.number().int() } },
    async ({ id }) =>
      run(async () => {
        const o = await getOrderFull(id);
        if (!o) throw new AdminError(`找不到訂單 #${id}`);
        return o;
      }),
  );
  server.registerTool(
    "update_order_status",
    {
      title: "更新訂單狀態",
      description: `更新訂單狀態並寫入訂單備註。狀態：${Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => `${k}=${v}`).join("、")}`,
      inputSchema: { id: z.number().int(), status: z.enum(Object.keys(ORDER_STATUS_LABEL) as [string, ...string[]]), note: z.string().optional() },
    },
    async ({ id, status, note }) => run(() => updateOrderStatus(id, status, actor, note)),
  );
  server.registerTool(
    "add_order_note",
    { title: "新增訂單備註", description: "新增訂單內部備註或給顧客的備註。", inputSchema: { id: z.number().int(), note: z.string(), is_customer_note: z.boolean().optional() } },
    async ({ id, note, is_customer_note }) => run(() => addOrderNote(id, note, actor, !!is_customer_note)),
  );

  // ---------- 表單 ----------
  server.registerTool(
    "list_forms",
    { title: "列出表單", description: "列出網站表單（聯絡我們、電子報、登入、註冊等）。", inputSchema: {} },
    async () => run(() => listRecords("forms", { limit: 100, columns: "id,slug,name,source,form_type,status,pages" })),
  );
  server.registerTool(
    "list_form_submissions",
    {
      title: "查詢表單提交",
      description: "查詢表單提交紀錄（可依表單 slug 或 ID、狀態篩選）。",
      inputSchema: { form_slug: z.string().optional(), form_id: z.number().int().optional(), status: z.enum(["unread", "read", "spam", "trash"]).optional(), ...listShape },
    },
    async ({ form_slug, form_id, status, limit, offset }) =>
      run(async () => {
        let fid = form_id;
        if (form_slug) {
          const { data } = await serviceDb().from("forms").select("id").eq("slug", form_slug).maybeSingle();
          if (!data) throw new AdminError(`找不到表單 ${form_slug}`);
          fid = data.id;
        }
        return listRecords("form_submissions", { filters: { form_id: fid, status }, limit: limit ?? 20, offset });
      }),
  );
  server.registerTool(
    "update_form_submission",
    { title: "更新表單提交狀態", description: "標記表單提交為 unread / read / spam / trash。", inputSchema: { id: z.number().int(), status: z.enum(["unread", "read", "spam", "trash"]) } },
    async ({ id, status }) => run(() => updateRecord("form_submissions", id, { status }, actor)),
  );

  // ---------- 網站設定 ----------
  server.registerTool(
    "get_settings",
    { title: "讀取網站設定", description: "讀取網站設定（鍵如 site.title、site.tagline、site.logo_media_id、contact、tracking.codes、footer.copyright、reading.page_on_front、woocommerce.* 等）。", inputSchema: { key: z.string().optional() } },
    async ({ key }) => run(() => getSettings(key)),
  );
  server.registerTool(
    "update_setting",
    {
      title: "修改網站設定",
      description: "寫入一個設定鍵的完整 JSON 值（會取代原值；請先 get_settings 取得原值再修改）。",
      inputSchema: { key: z.string(), value: z.any(), is_public: z.boolean().optional() },
    },
    async ({ key, value, is_public }) => run(() => setSetting(key, value, actor, is_public)),
  );

  // ---------- 通用資料表 ----------
  const entityEnum = z.enum(GENERIC);
  const describeEntities = GENERIC.map((k) => `${k}（${ENTITIES[k].label}；欄位：${ENTITIES[k].fields.map((f) => f.name).join(",")}）`).join("\n");
  server.registerTool(
    "list_records",
    {
      title: "列出資料",
      description: `通用查詢：優惠券、顧客、轉址、選單、票種／團報折扣規則（discount_rules）、變體（票種）等。\n${describeEntities}`,
      inputSchema: { entity: entityEnum, filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(), ...listShape },
    },
    async ({ entity, filters, search, limit, offset }) => run(() => listRecords(entity, { q: search, filters, limit: limit ?? 20, offset })),
  );
  server.registerTool(
    "get_record",
    { title: "讀取資料", description: "通用讀取單筆資料。", inputSchema: { entity: entityEnum, id: z.union([z.number(), z.string()]) } },
    async ({ entity, id }) =>
      run(async () => {
        const r = await getRecord(entity, id);
        if (!r) throw new AdminError("找不到資料");
        return r;
      }),
  );
  server.registerTool(
    "create_record",
    { title: "新增資料", description: "通用新增（只接受該資料表白名單欄位）。", inputSchema: { entity: entityEnum, data: z.record(z.string(), z.any()) } },
    async ({ entity, data }) =>
      run(async () => {
        if (entity === "media") throw new AdminError("媒體請用 upload_media");
        return createRecord(entity, data as Row, actor);
      }),
  );
  server.registerTool(
    "update_record",
    { title: "修改資料", description: "通用修改（只傳要改的欄位）。", inputSchema: { entity: entityEnum, id: z.union([z.number(), z.string()]), data: z.record(z.string(), z.any()) } },
    async ({ entity, id, data }) => run(() => updateRecord(entity, id, data as Row, actor)),
  );
  server.registerTool(
    "delete_record",
    { title: "刪除資料", description: "通用刪除（永久）。媒體會一併刪除檔案。", inputSchema: { entity: entityEnum, id: z.union([z.number(), z.string()]) } },
    async ({ entity, id }) => run(() => deleteRecord(entity, id, actor)),
  );

  // ---------- 稽核 ----------
  server.registerTool(
    "get_audit_log",
    {
      title: "查詢稽核紀錄",
      description: "查詢後台與 MCP 的寫入紀錄。",
      inputSchema: { entity_type: z.string().optional(), entity_id: z.string().optional(), via: z.enum(["admin", "mcp", "system", "import"]).optional(), limit: z.number().int().min(1).max(200).optional() },
    },
    async ({ entity_type, entity_id, via, limit }) =>
      run(async () => {
        let q = serviceDb().from("audit_log").select("*").order("created_at", { ascending: false }).limit(limit ?? 20);
        if (entity_type) q = q.eq("entity_type", entity_type);
        if (entity_id) q = q.eq("entity_id", entity_id);
        if (via) q = q.eq("via", via);
        const { data, error } = await q;
        if (error) throw new AdminError(error.message);
        return data;
      }),
  );

  return server;
}
