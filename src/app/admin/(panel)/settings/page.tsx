import { requireAdmin } from "@/lib/admin/guard";
import { getSettings } from "@/lib/admin/service";
import { fmtDate } from "@/lib/admin/format";
import { mediaMap, type SP } from "@/lib/admin/loaders";
import { Flash } from "@/components/admin/Fields";
import { MediaPicker } from "@/components/admin/MediaPicker";
import { saveSettingsAction } from "../../actions";

export default async function Settings({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;
  const rows = await getSettings();
  const s: Record<string, any> = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const media = await mediaMap([s["site.logo_media_id"], s["site.icon_media_id"]]);
  const logo = s["site.logo_media_id"] ? media[s["site.logo_media_id"]] || null : null;
  const icon = s["site.icon_media_id"] ? media[s["site.icon_media_id"]] || (s["site.icon_url"] ? { id: s["site.icon_media_id"], url: s["site.icon_url"] } : null) : null;
  const t = (s["tracking.codes"] || {}) as Record<string, any>;
  const text = (name: string, label: string, value: unknown, help?: string) => (
    <div className="adm-field">
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} defaultValue={String(value ?? "")} />
      {help ? <div className="adm-help">{help}</div> : null}
    </div>
  );
  return (
    <>
      <h1 className="adm-h1">網站設定</h1>
      <Flash sp={sp} />
      <form action={saveSettingsAction}>
        <div className="adm-cols2">
          <div className="adm-card">
            <h2 className="adm-h2">一般</h2>
            {text("site_name", "網站名稱", s["site.title"])}
            {text("site_description", "網站說明（標語）", s["site.tagline"])}
            <div className="adm-field">
              <label>網站 Logo</label>
              <MediaPicker name="logo_media_id" initial={logo} />
              <div className="adm-help">頁首 Logo；更換後前台頁首立即套用。</div>
            </div>
            <div className="adm-field">
              <label>網站圖示（favicon）</label>
              <MediaPicker name="icon_media_id" initial={icon} />
            </div>
            {text("footer_copyright", "頁尾版權文字", s["footer.copyright"])}
          </div>
          <div className="adm-card">
            <h2 className="adm-h2">聯絡資訊與社群</h2>
            {text("contact_email", "Email", s.contact?.email)}
            {text("contact_phone", "電話", s.contact?.phone)}
            {text("contact_line", "LINE 官方帳號網址", s.contact?.line)}
            {text("contact_address", "地址", s.contact?.address)}
            {text("social_facebook", "Facebook 網址", s.social?.facebook)}
            {text("social_instagram", "Instagram 網址", s.social?.instagram)}
            {text("social_youtube", "YouTube 網址", s.social?.youtube)}
            {text("social_line", "LINE 社群網址", s.social?.line)}
            <h2 className="adm-h2 adm-mt">追蹤碼</h2>
            {text("tracking_gtag", "Google tag ID（Site Kit）", t.gtag_id, "例：GT-XXXXXXX 或 G-XXXXXXX；留空則不載入")}
            {text("tracking_amplitude", "Amplitude API key", t.amplitude_key, "含 Session Replay 與 Experiment；留空則不載入")}
            {text("tracking_cloudflare", "Cloudflare Web Analytics token", t.cloudflare_token)}
            <label className="adm-check"><input type="checkbox" name="tracking_hubspot" defaultChecked={t.hubspot !== false} /> HubSpot（leadin）頁面追蹤</label>
            <div className="adm-field adm-mt">
              <label htmlFor="tracking_custom">自訂追蹤程式碼</label>
              <textarea id="tracking_custom" name="tracking_custom" className="plain" rows={4} defaultValue={String(t.custom_head_html || "")} />
              <div className="adm-help">例如 Meta Pixel 等其他追蹤碼（伺服器端原樣輸出於前台每一頁 body 結尾，首次載入時執行）。</div>
            </div>
          </div>
        </div>
        <button className="adm-btn pri" type="submit">儲存設定</button>
      </form>
      <div className="adm-card adm-mt">
        <h2 className="adm-h2">所有設定值（進階）</h2>
        <p className="adm-muted">以下為資料庫中的原始設定（含運費、付款方式、閱讀設定等），可個別以 JSON 編輯。</p>
        <table className="adm-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ width: 200 }}>
                  <a href={`/admin/e/settings/${encodeURIComponent(r.key)}/`}><b>{r.key}</b></a>
                  <div className="adm-muted">{r.is_public ? "公開" : "私有"}・{fmtDate(r.updated_at)}{r.description ? `・${r.description}` : ""}</div>
                </td>
                <td><pre className="adm-json" style={{ maxHeight: 120 }}>{JSON.stringify(r.value, null, 2)}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="adm-mt"><a className="adm-btn sm" href="/admin/e/settings/new/">新增設定鍵</a></p>
      </div>
    </>
  );
}
