# DayinUP 搬遷說明：與舊站 (dayinup.com) 的刻意差異

驗收時以下差異是**刻意的**，不算回歸。其餘頁面以 1:1 重現舊站為準。

| 網址 / 項目 | 舊站 | 新站 | 決定與理由 |
|---|---|---|---|
| `/shop/` 的 `<title>` | `Page Not Found - DayinUP`（HTTP 200、`index`，商品格線正常顯示） | `商品 - DayinUP` | **刻意修正**。舊站是 Rank Math 對 WooCommerce 商店頁的錯誤標題：頁面本身正常且可被索引，搜尋結果卻顯示「Page Not Found」。HTTP 狀態（200）、內容與 robots 與舊站相同，只修正標題、og:title 與 schema 名稱。 |
| `/contact/` | 404 | 200，聯絡表單（寫入 `form_submissions`） | **刻意新增**。舊站沒有這個頁面；新站提供聯絡表單，送出的內容寫入 `form_submissions`，後台和 MCP 都查得到。這個網址在舊站是 404，所以不會改變任何舊網址的行為。 |
| `/blog/` | 404 | 200，文章列表 | **刻意新增**。舊站文章只能從分類或標籤頁進入；新站多一個總列表。所有舊網址（`/category/…`、`/tag/…`、文章 permalink）都保留。 |
| 商品頁「票種與團報優惠」折疊表 | 沒有 | **已移除**（2026-10-25） | 為了 1:1 重現舊站，舊站商品頁沒有這個區塊。折扣規則資料（`quantity_discount_rules`）仍保留在資料庫。 |
| 商品分類計數（`terms.count`） | WordPress `wp_term_taxonomy.count` | 與 WordPress 相同 | 改用 WordPress 存的計數（= 實際指派到該分類的已發布商品數）。先前 Store API 抽取的值不正確：`all`（term 15）是 77，但沒有任何商品屬於它（舊站 `/product-category/all/` 顯示「找不到符合您選擇的商品」）；`talk2talk` 是 2，實際只有 1 個商品。`scripts/data/import-private.py` 會從 `wp_term_taxonomy` 同步計數，並在對帳時檢查。 |

## 資料匯入順序
1. `scripts/data/import-public.py`（公開內容）
2. `scripts/data/import-private.py`（私有資料；會覆寫庫存欄位、分類計數，並匯入草稿頁面）

`import-private.py` 會覆寫 `import-public.py` 寫入的這些值：
- **庫存**：`stock_status` / `backorders` / `manage_stock` / `stock_quantity` 改用 `wp_postmeta`。Store API 會把 `_manage_stock=no` 的變體報成父商品的庫存（例如 party-2025-09-14 的票種實際是 `onbackorder`，父商品 `backorders=yes`）。
- **草稿頁面**：`post_status=draft` 的頁面匯入為 `status=draft`、`path=null`。不公開（RLS 與前台只讀 `publish`），但後台內容列表與預覽看得到。
- **顧客**：如果訪客結帳紀錄（`wc_customer_lookup`）的 email 和註冊會員（`wp_users`）相同，就合併成同一位顧客，並把訂單改為指向會員那筆。顧客筆數 = 不重複 email 數。
- 新站後台管理員第一次在前台登入時，會建立一筆 `meta.site_admin=true` 的顧客紀錄，這筆不列入後台顧客統計。

## 測試資料
`scripts/frontend/e2e.js` 會實際下一張測試訂單（email `migration-test@gathertaiwan.com`，備註含 `DAYINUP-FRONTEND-TEST`）。跑完後一定會刪掉它，即使中途失敗也會刪。刪除只限新站 id（≥ 1000000），而且三個條件都要符合。執行時需要 `SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY` 環境變數。
